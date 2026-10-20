// See online documentation for examples
// https://docs.getdrafts.com/docs/actions/scripting

const FRESH_DRAFT_MINUTES = 30;
const TIME_ZONE_STATE_PATH = '/save2twos-state.json';

async function main() {
  const cred = getCredential();

  if (cred === null) {
    app.displayErrorMessage('没有配置 API 信息');
    context.cancel();
    return;
  }

  if (!draft.content || !draft.content.trim()) {
    app.displayErrorMessage('内容为空');
    context.cancel();
    return;
  }

  const createdAt = draft.createdAt;
  if (!createdAt || typeof createdAt.getTime !== 'function' || !Number.isFinite(createdAt.getTime())) {
    throw new Error('无法读取草稿创建时间，未发送');
  }

  const now = Date.now();
  const deviceZone = normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const fileManager = FileManager.createLocal();
  const state = readTimeZoneState(fileManager);
  const age = now - createdAt.getTime();
  const fresh = age >= 0 && age <= FRESH_DRAFT_MINUTES * 60000;
  const changed = state !== null && state.lastDeviceTimeZone !== deviceZone;
  let reminder = state && state.oldDraftReminder;
  if (reminder && (changed || reminder.deviceZone !== deviceZone
    || now < Date.parse(reminder.selectedAt) || now >= Date.parse(reminder.expiresAt))) {
    reminder = null;
  }
  let creationZone = deviceZone;
  if (!fresh && reminder) {
    creationZone = reminder.creationZone;
  } else if (!fresh) {
    const selection = selectCreationTimeZone(deviceZone, changed ? state.lastDeviceTimeZone : null);
    if (selection === null) {
      context.cancel();
      return;
    }
    creationZone = selection.creationZone;
    reminder = selection.reminder;
  } else if (changed) {
    const prompt = Prompt.create();
    prompt.title = '设备时区已变化';
    prompt.message = '上次发送：' + state.lastDeviceTimeZone + '\n当前设备：' + deviceZone
      + '\n这是一篇新记录。是否采用当前时区归档并发送？';
    prompt.addButton('使用当前时区并发送');
    if (!prompt.show()) {
      context.cancel();
      return;
    }
  }

  // v1 supplies the source tag separately; preserve the user's text verbatim.
  putMemo(cred, draft.content, createdAt, creationZone, sourceTags(draft.tags));

  // Persist the sending device's zone, never the source zone chosen for an old draft.
  // A local write failure after HTTP success must not invite a duplicate create.
  try {
    const nextState = {
      version: 1,
      lastDeviceTimeZone: deviceZone,
      lastSentAt: new Date(now).toISOString()
    };
    if (reminder) nextState.oldDraftReminder = reminder;
    if (!fileManager.writeJSON(TIME_ZONE_STATE_PATH, nextState)) {
      throw new Error('state write failed');
    }
  } catch (_) {
    app.displayErrorMessage('已发送到 Twos，但未能保存时区状态；请勿重复发送。下次可能再次询问时区。');
  }
}

function normalizeTimeZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) {
    throw new Error('请选择有效的创建时区，未发送');
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone.trim() }).resolvedOptions().timeZone;
  } catch (_) {
    throw new Error('时区无效，请填写 Asia/Shanghai 等时区名称，未发送');
  }
}

function readTimeZoneState(fileManager) {
  try {
    if (!fileManager.exists(TIME_ZONE_STATE_PATH)) return null;
    const state = fileManager.readJSON(TIME_ZONE_STATE_PATH);
    if (!state || state.version !== 1) throw new Error('invalid state');
    return {
      lastDeviceTimeZone: normalizeTimeZone(state.lastDeviceTimeZone),
      oldDraftReminder: readOldDraftReminder(state.oldDraftReminder)
    };
  } catch (_) {
    throw new Error('无法读取本地时区状态，请检查 /save2twos-state.json，未发送');
  }
}

function readOldDraftReminder(value) {
  // Older v1 state has no reminder. Invalid optional data restores prompting.
  if (!value || typeof value.selectedAt !== 'string' || typeof value.expiresAt !== 'string') return null;
  const selectedAt = Date.parse(value.selectedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (!Number.isFinite(selectedAt) || !Number.isFinite(expiresAt)
    || expiresAt <= selectedAt || expiresAt - selectedAt > 7 * 24 * 3600000) return null;
  try {
    return {
      creationZone: normalizeTimeZone(value.creationZone),
      deviceZone: normalizeTimeZone(value.deviceZone),
      selectedAt: new Date(selectedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString()
    };
  } catch (_) {
    return null;
  }
}

function nextLocalMidnight(now, zone) {
  // Locate the next local date boundary, rather than adding 24 hours.
  // This works for both 23-hour and 25-hour daylight-saving days.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const dayAt = (time) => formatter.format(new Date(time));
  const today = dayAt(now);
  let low = now;
  let high = now + 36 * 3600000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dayAt(middle) === today) low = middle;
    else high = middle;
  }
  return high;
}

function selectCreationTimeZone(deviceZone, previousZone) {
  const prompt = Prompt.create();
  prompt.title = '选择草稿创建时区';
  prompt.message = '这篇草稿已超过 ' + FRESH_DRAFT_MINUTES + ' 分钟，或创建时间在未来。'
    + '\n请选择创建时所在的时区。上海：中国；芝加哥：美国中部。'
    + '\n可仅发送本条，或在一段时间内让旧稿沿用所选时区；设备时区变化会重新确认。'
    + '\n当前设备：' + deviceZone
    + (previousZone ? '\n上次发送设备：' + previousZone + '（已变化）' : '');
  const zones = [...new Set(['Asia/Shanghai', 'America/Chicago', deviceZone])];
  prompt.addSelect('creationZone', '创建时区', zones.concat('其他时区'), [], false);
  prompt.addTextField('customZone', '其他时区（选择“其他时区”时填写）', '', {
    autocorrect: false,
    placeholder: '例如 America/Los_Angeles'
  });
  prompt.addButton('按所选时区发送');
  prompt.addButton('今天不再询问（午夜恢复）');
  prompt.addButton('7 天内不再询问');
  if (!prompt.show()) return null;
  const choices = prompt.fieldValues.creationZone;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw new Error('请选择创建时区，未发送');
  }
  const selected = choices[0];
  if (selected !== '其他时区' && !zones.includes(selected)) {
    throw new Error('请选择有效的创建时区，未发送');
  }
  const creationZone = normalizeTimeZone(selected === '其他时区' ? prompt.fieldValues.customZone : selected);
  const selectedAt = Date.now();
  let expiresAt = null;
  if (prompt.buttonPressed === '今天不再询问（午夜恢复）') {
    expiresAt = nextLocalMidnight(selectedAt, deviceZone);
  } else if (prompt.buttonPressed === '7 天内不再询问') {
    expiresAt = selectedAt + 7 * 24 * 3600000;
  }
  return {
    creationZone: creationZone,
    reminder: expiresAt === null ? null : {
      creationZone: creationZone,
      deviceZone: deviceZone,
      selectedAt: new Date(selectedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString()
    }
  };
}

function creationDay(createdAt, zone) {
  // Interpret the original instant in the selected zone, including historical DST.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(createdAt);
  const value = (name) => parts.find((part) => part.type === name).value;
  return value('year') + '-' + value('month') + '-' + value('day');
}

function sourceTags(nativeTags) {
  const tags = ['drafts'];
  const seen = new Set(['drafts']);
  for (const value of Array.isArray(nativeTags) ? nativeTags : []) {
    if (typeof value !== 'string') continue;
    const tag = value.trim();
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      tags.push(tag);
      seen.add(key);
    }
  }
  return tags;
}

function putMemo(cred, content, createdAt, creationZone, tags) {
  const http = HTTP.create();
  const data = {
    text: content,
    tags: tags,
    created: createdAt.toISOString(),
    list: creationDay(createdAt, creationZone)
  };
  let response;
  try {
    response = http.request({
      url: 'https://www.twosapp.com/api/v1/things',
      method: 'POST',
      encoding: 'json',
      data: data,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cred.api_key
      }
    });
  } catch (_) {
    throw new Error('发送到 Twos 失败，请检查网络和 API 配置');
  }

  // The v1 create endpoint returns 201; do not retry ambiguous creates.
  if (response.statusCode !== 201) {
    const status = Number(response.statusCode);
    throw new Error(Number.isInteger(status) && status > 0
      ? '发送到 Twos 失败（HTTP ' + status + '）'
      : '发送到 Twos 失败，请检查网络和 API 配置');
  }
}

function getCredential() {
  const credential = Credential.create('Post to Twos v1', 'Twos API key（需要 write:things 权限）');
  credential.addPasswordField('api_key', 'Twos API Key');
  if (!credential.authorize()) {
    return null;
  }

  const cred = {
    api_key: credential.getValue('api_key')
  };
  if (!Object.values(cred).every((value) => typeof value === 'string' && value.trim())) {
    return null;
  }
  cred.api_key = cred.api_key.trim();
  return cred;
}

main()
  .then(() => script.complete())
  .catch((err) => {
    context.fail(err.message);
    script.complete();
  });
