const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'save2twos.js'), 'utf8');

// Drafts APIs only exist in the app. Execute the actual action with boundary stubs.
async function run({ content = '一条笔记', authorized = true, values = {}, response,
  networkError = false, createdAt = new Date('2026-10-19T11:23:45+08:00'),
  now = new Date('2026-10-19T03:30:00Z'), deviceZone = 'Asia/Shanghai', state = null,
  promptAccepted = true, selectedZone = 'Asia/Shanghai', customZone = '',
  saveOK = true, stateReadError = false, uuid = '12345678-1234-4321-9876-123456789abc',
  draftTags = ['private'], pressedButton = '按所选时区发送',
  credentialFailure = '', httpCreateFailure = false } = {}) {
  const result = { requests: [], errors: [], failures: [], canceled: 0, completed: 0,
    logs: [], passwordFields: [], prompts: [], writes: [] };
  const credentials = { api_key: 'test-secret', ...values };
  const draft = { content, tags: draftTags, createdAt, uuid };
  const sandbox = {
    draft,
    Date: class extends Date { static now() { return now.getTime(); } },
    Intl: { DateTimeFormat: function(locale, options) {
      return new Intl.DateTimeFormat(locale, { timeZone: deviceZone, ...options });
    } },
    FileManager: { createLocal: () => ({
      exists: () => state !== null,
      readJSON() { if (stateReadError) throw new Error('unreadable'); return state; },
      writeJSON(file, data) { result.writes.push({ file, data }); return saveOK; },
    }) },
    Prompt: { create: () => {
      const prompt = {
        fieldValues: {}, choices: [], buttons: [], buttonPressed: pressedButton,
        addButton(name) { this.buttons.push(name); },
        addSelect(name, label, choices) {
          this.choices = choices;
          this.fieldValues[name] = selectedZone === null ? [] : [selectedZone];
        },
        addTextField(name) { this.fieldValues[name] = customZone; },
        show() { result.prompts.push(this); return promptAccepted; },
      };
      return prompt;
    } },
    Credential: { create: (identifier) => {
      if (credentialFailure === 'create') throw new Error('Credential failure: test-secret');
      result.credentialIdentifier = identifier; return ({
      addTextField() {},
      addPasswordField(key) { result.passwordFields.push(key); },
      authorize() {
        if (credentialFailure === 'authorize') throw new Error('Credential failure: test-secret');
        return authorized;
      },
      getValue(key) {
        if (credentialFailure === 'read') throw new Error('Credential failure: test-secret');
        return credentials[key];
      },
    }); } },
    HTTP: { create: () => {
      if (httpCreateFailure) throw new Error('HTTP factory failure: test-secret');
      return ({ request(options) {
      result.requests.push(options);
      if (networkError) throw new Error('Network failed: test-secret');
      return response === undefined ? { statusCode: 201, success: true } : response;
    } }); } },
    app: { displayErrorMessage: (message) => result.errors.push(message) },
    context: {
      cancel() { result.canceled++; },
      fail(message) { result.failures.push(message); },
    },
    script: { complete() { result.completed++; } },
    console: { log: (...args) => result.logs.push(args) },
  };
  await vm.runInNewContext(source, sandbox);
  result.draft = draft;
  assert.equal(result.completed, 1, 'Action must finish exactly once');
  return result;
}

test('uses official v1 JSON request and Bearer key while preserving original draft', async () => {
  const r = await run({ content: '正文\n第二行  ' });
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].data.text, '正文\n第二行  ');
  assert.equal(r.draft.content, '正文\n第二行  ');
  assert.deepEqual(r.draft.tags, ['private']);
  assert.equal(r.requests[0].data.token, undefined);
  assert.equal(r.requests[0].data.user_id, undefined);
  assert.deepEqual(Array.from(r.requests[0].data.tags), ['drafts', 'private']);
  assert.equal(r.requests[0].data.created, '2026-10-19T03:23:45.000Z');
  assert.equal(r.requests[0].headers.Authorization, 'Bearer test-secret');
  assert.equal(r.requests[0].headers['Content-Type'], 'application/json');
  assert.equal(r.requests[0].encoding, 'json');
  assert.equal(r.requests[0].url, 'https://www.twosapp.com/api/v1/things');
  assert.equal(r.requests[0].method, 'POST');
  assert.deepEqual(r.failures, []);
  assert.notEqual(r.credentialIdentifier, 'Post to Twos');
});

for (const content of ['#drafts', '正文 #drafts', '#DRAFTS\n正文']) {
  test(`preserves user-written source hashtags: ${JSON.stringify(content)}`, async () => {
    const r = await run({ content });
    assert.equal(r.requests[0].data.text, content);
    assert.deepEqual(Array.from(r.requests[0].data.tags), ['drafts', 'private']);
  });
}

for (const content of ['#draftsmanship', 'https://example.invalid/#drafts', '#drafts中文']) {
  test(`native source tag leaves other text untouched: ${content}`, async () => {
    const r = await run({ content });
    assert.equal(r.requests[0].data.text, content);
    assert.deepEqual(Array.from(r.requests[0].data.tags), ['drafts', 'private']);
  });
}

test('canceling credentials sends nothing', async () => {
  const r = await run({ authorized: false });
  assert.equal(r.requests.length, 0);
  assert.equal(r.canceled, 1);
});

for (const field of ['api_key']) {
  test(`missing ${field} sends nothing`, async () => {
    const r = await run({ values: { [field]: '  ' } });
    assert.equal(r.requests.length, 0);
    assert.equal(r.canceled, 1);
  });
}

for (const content of ['', ' \n\t ']) {
  test(`empty content sends nothing: ${JSON.stringify(content)}`, async () => {
    const r = await run({ content });
    assert.equal(r.requests.length, 0);
    assert.equal(r.canceled, 1);
  });
}

test('HTTP rejection gives status without exposing response or credentials', async () => {
  const r = await run({ response: { statusCode: 401, success: false,
    responseText: 'test-secret', error: undefined } });
  assert.match(r.failures[0], /401/);
  assert.doesNotMatch(r.failures[0], /test-secret/);
  assert.deepEqual(r.logs, []);
});

test('transport exception gives safe failure and does not retry', async () => {
  const r = await run({ networkError: true });
  assert.equal(r.requests.length, 1);
  assert.match(r.failures[0], /网络/);
  assert.doesNotMatch(r.failures[0], /test-secret/);
  assert.deepEqual(r.logs, []);
});

test('API key input is hidden', async () => {
  const r = await run();
  assert.ok(r.passwordFields.includes('api_key'));
});

for (const createdAt of [null, 'not-a-date', new Date('invalid')]) {
  test(`invalid or missing creation date stops sending: ${String(createdAt)}`, async () => {
    const r = await run({ createdAt });
    assert.equal(r.requests.length, 0);
    assert.match(r.failures[0], /创建时间/);
  });
}

const savedState = (zone) => ({ version: 1, lastDeviceTimeZone: zone,
  lastSentAt: '2026-10-18T00:00:00Z' });

test('fresh draft in unchanged zone sends without prompting and saves device zone', async () => {
  const r = await run({ state: savedState('Asia/Shanghai') });
  assert.equal(r.requests.length, 1);
  assert.equal(r.prompts.length, 0);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].data.lastDeviceTimeZone, 'Asia/Shanghai');
  assert.equal(r.requests[0].data.text, '一条笔记');
});

test('first fresh send needs no prompt', async () => {
  const r = await run();
  assert.equal(r.prompts.length, 0);
  assert.equal(r.writes.length, 1);
});

test('sends clean text and source tag without attached note or original link', async () => {
  const r = await run({ content: '正文\n第二行  ' });
  const data = r.requests[0].data;
  assert.equal(data.text, '正文\n第二行  ');
  assert.deepEqual(Array.from(data.tags), ['drafts', 'private']);
  assert.equal(Object.hasOwn(data, 'note'), false);
  assert.equal(Object.hasOwn(data, 'url'), false);
  assert.equal(r.draft.content, '正文\n第二行  ');
});

for (const uuid of [null, '', '   ']) {
  test(`sending no longer requires a UUID: ${JSON.stringify(uuid)}`, async () => {
    const r = await run({ uuid });
    assert.equal(r.requests.length, 1);
    assert.deepEqual(r.failures, []);
    assert.equal(Object.hasOwn(r.requests[0].data, 'url'), false);
  });
}

test('chosen Chinese day and exact instant survive removing metadata', async () => {
  const r = await run({ createdAt: new Date('2026-10-19T00:23:45.123+08:00'),
    now: new Date('2026-10-21T12:00:00Z'), deviceZone: 'America/Chicago',
    selectedZone: 'Asia/Shanghai' });
  const data = r.requests[0].data;
  assert.equal(data.created, '2026-10-18T16:23:45.123Z');
  assert.equal(data.list, '2026-10-19');
  assert.equal(Object.hasOwn(data, 'note'), false);
});

test('fractional-hour creation zone still selects the correct day', async () => {
  const r = await run({ createdAt: new Date('2026-10-18T18:30:00Z'),
    now: new Date('2026-10-21T12:00:00Z'), selectedZone: '其他时区', customZone: 'Asia/Kathmandu' });
  assert.equal(r.requests[0].data.list, '2026-10-19');
});

test('repeated sends still create independent things without updates or source-ID mapping', async () => {
  const r = await run();
  const again = await run({ state: r.writes[0].data });
  assert.equal(r.requests.length, 1);
  assert.equal(again.requests.length, 1);
  assert.equal(again.requests[0].method, 'POST');
  assert.equal(again.requests[0].url, 'https://www.twosapp.com/api/v1/things');
  assert.deepEqual(Object.keys(again.writes[0].data).sort(),
    ['lastDeviceTimeZone', 'lastSentAt', 'version']);
});

test('fresh send after timezone change asks before updating', async () => {
  const r = await run({ state: savedState('America/Chicago') });
  assert.equal(r.prompts.length, 1);
  assert.match(r.prompts[0].message, /America\/Chicago/);
  assert.match(r.prompts[0].message, /Asia\/Shanghai/);
  assert.equal(r.writes[0].data.lastDeviceTimeZone, 'Asia/Shanghai');
});

test('canceling zone change sends nothing and leaves state untouched', async () => {
  const r = await run({ state: savedState('America/Chicago'), promptAccepted: false });
  assert.equal(r.requests.length, 0);
  assert.equal(r.writes.length, 0);
  assert.equal(r.canceled, 1);
});

test('old Chinese draft sent from US uses selected Chinese day without updating to Chinese device zone', async () => {
  const r = await run({ createdAt: new Date('2026-10-19T00:23:00+08:00'),
    now: new Date('2026-10-21T12:00:00Z'), deviceZone: 'America/Chicago',
    state: savedState('America/Chicago'), selectedZone: 'Asia/Shanghai' });
  assert.equal(r.prompts.length, 1);
  assert.equal(r.requests[0].data.list, '2026-10-19');
  assert.equal(r.requests[0].data.created, '2026-10-18T16:23:00.000Z');
  assert.equal(r.requests[0].data.text, '一条笔记');
  assert.deepEqual(Array.from(r.prompts[0].choices).slice(0, 2), ['Asia/Shanghai', 'America/Chicago']);
  assert.equal(r.writes[0].data.lastDeviceTimeZone, 'America/Chicago');
});

test('old draft and changed device zone use a single selection prompt', async () => {
  const r = await run({ now: new Date('2026-10-21T12:00:00Z'),
    state: savedState('America/Chicago') });
  assert.equal(r.prompts.length, 1);
  assert.equal(r.requests.length, 1);
});

test('old draft cancellation stops sending and saving', async () => {
  const r = await run({ now: new Date('2026-10-21T12:00:00Z'), promptAccepted: false });
  assert.equal(r.requests.length, 0);
  assert.equal(r.writes.length, 0);
  assert.equal(r.canceled, 1);
});

for (const [age, expectedPrompts] of [[30 * 60000, 0], [30 * 60000 + 1, 1], [-1, 1]]) {
  test(`fresh/old boundary at age ${age}ms`, async () => {
    const r = await run({ createdAt: new Date('2026-10-19T03:23:45Z'),
      now: new Date(new Date('2026-10-19T03:23:45Z').getTime() + age) });
    assert.equal(r.prompts.length, expectedPrompts);
  });
}

test('old drafts require an explicit source zone', async () => {
  const r = await run({ now: new Date('2026-10-21T12:00:00Z'), selectedZone: null });
  assert.equal(r.requests.length, 0);
  assert.match(r.failures[0], /时区/);
});

test('custom IANA zone controls day and appears after top candidates', async () => {
  const r = await run({ createdAt: new Date('2026-10-19T00:30:00Z'),
    now: new Date('2026-10-21T12:00:00Z'), deviceZone: 'Europe/London',
    selectedZone: '其他时区', customZone: 'Pacific/Honolulu' });
  assert.equal(r.requests[0].data.list, '2026-10-18');
  assert.deepEqual(Array.from(r.prompts[0].choices),
    ['Asia/Shanghai', 'America/Chicago', 'Europe/London', '其他时区']);
});

test('invalid custom zone stops sending', async () => {
  const r = await run({ now: new Date('2026-10-21T12:00:00Z'),
    selectedZone: '其他时区', customZone: 'not-a-zone' });
  assert.equal(r.requests.length, 0);
  assert.equal(r.writes.length, 0);
  assert.match(r.failures[0], /时区/);
});

for (const [instant, expectedDay] of [['2026-07-19T05:30:00Z', '2026-07-19'],
  ['2026-01-19T05:30:00Z', '2026-01-18']]) {
  test(`Chicago uses creation date DST rules: ${instant}`, async () => {
    const r = await run({ createdAt: new Date(instant), now: new Date('2026-10-21T12:00:00Z'),
      selectedZone: 'America/Chicago' });
    assert.equal(r.requests[0].data.list, expectedDay);
    assert.equal(r.requests[0].data.created, instant.replace('Z', '.000Z'));
  });
}

for (const opts of [{ networkError: true }, { response: { statusCode: 401, success: false } }]) {
  test(`failed send does not update state: ${JSON.stringify(opts)}`, async () => {
    const r = await run(opts);
    assert.equal(r.writes.length, 0);
  });
}

test('state write failure warns that creation succeeded without failing the action', async () => {
  const r = await run({ saveOK: false });
  assert.equal(r.requests.length, 1);
  assert.deepEqual(r.failures, []);
  assert.ok(r.errors.some((s) => /已发送/.test(s) && /重复发送/.test(s)));
});

test('unreadable state fails before sending', async () => {
  const r = await run({ state: savedState('Asia/Shanghai'), stateReadError: true });
  assert.equal(r.requests.length, 0);
  assert.match(r.failures[0], /状态/);
});

test('invalid stored state fails before sending', async () => {
  const r = await run({ state: { version: 99 } });
  assert.equal(r.requests.length, 0);
  assert.match(r.failures[0], /状态/);
});

test('non-throwing transport failure gives safe error', async () => {
  const r = await run({ response: { statusCode: 0, success: false, error: 'test-secret' } });
  assert.match(r.failures[0], /网络/);
  assert.doesNotMatch(r.failures[0], /test-secret/);
});

test('other HTTP statuses are failures without fallback creates', async () => {
  const r = await run({ response: { statusCode: 400, success: false } });
  assert.equal(r.requests.length, 1);
  assert.match(r.failures[0], /400/);
});

for (const hour of [0, 23]) {
  test(`places the thing on the creation's local day near midnight: ${hour}:30`, async () => {
    const createdAt = new Date(2026, 9, 19, hour, 30, 0);
    const r = await run({ createdAt, now: new Date(createdAt.getTime() + 60000),
      deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    assert.equal(r.requests[0].data.list, '2026-10-19');
    assert.equal(r.requests[0].data.created, createdAt.toISOString());
  });
}


test('syncs all native Drafts tags together with the fixed source tag', async () => {
  const r = await run({ draftTags: ['work', 'travel'], content: '正文 #not-native' });
  assert.deepEqual(Array.from(r.requests[0].data.tags), ['drafts', 'work', 'travel']);
  assert.equal(r.requests[0].data.text, '正文 #not-native');
  assert.deepEqual(r.draft.tags, ['work', 'travel']);
});

test('trims blanks and deduplicates tag names case-insensitively without mutating originals', async () => {
  const tags = ['Drafts', 'work', 'WORK', ' travel ', '', '  ', '项目/设备'];
  const r = await run({ draftTags: tags });
  assert.deepEqual(Array.from(r.requests[0].data.tags), ['drafts', 'work', 'travel', '项目/设备']);
  assert.deepEqual(r.draft.tags, ['Drafts', 'work', 'WORK', ' travel ', '', '  ', '项目/设备']);
});

for (const tags of [[], null]) {
  test(`source tag survives absent native tags: ${JSON.stringify(tags)}`, async () => {
    const r = await run({ draftTags: tags });
    assert.deepEqual(Array.from(r.requests[0].data.tags), ['drafts']);
  });
}

const oldNow = new Date('2026-10-21T12:00:00Z');
const reminderState = (overrides = {}) => ({
  ...savedState('Asia/Shanghai'),
  oldDraftReminder: {
    creationZone: 'America/Chicago', deviceZone: 'Asia/Shanghai',
    selectedAt: '2026-10-21T11:00:00.000Z', expiresAt: '2026-10-21T16:00:00.000Z',
    ...overrides,
  },
});

test('old draft prompt offers one-time send and both reminder durations', async () => {
  const r = await run({ now: oldNow });
  assert.deepEqual(r.prompts[0].buttons, ['按所选时区发送', '今天不再询问（午夜恢复）', '7 天内不再询问']);
});

test('today choice saves selected creation zone until device-local midnight', async () => {
  const r = await run({ now: oldNow, selectedZone: 'America/Chicago',
    pressedButton: '今天不再询问（午夜恢复）' });
  const preference = r.writes[0].data.oldDraftReminder;
  assert.equal(preference.creationZone, 'America/Chicago');
  assert.equal(preference.deviceZone, 'Asia/Shanghai');
  assert.equal(preference.expiresAt, '2026-10-21T16:00:00.000Z');
});

test('today expires at midnight in the device zone even on a 25-hour DST day', async () => {
  const r = await run({ now: new Date('2026-11-01T00:30:00-05:00'),
    deviceZone: 'America/Chicago', pressedButton: '今天不再询问（午夜恢复）' });
  assert.equal(r.writes[0].data.oldDraftReminder.expiresAt, '2026-11-02T06:00:00.000Z');
});

test('today expires at midnight in the device zone on a 23-hour DST day', async () => {
  const r = await run({ now: new Date('2026-03-08T00:30:00-06:00'),
    deviceZone: 'America/Chicago', pressedButton: '今天不再询问（午夜恢复）' });
  assert.equal(r.writes[0].data.oldDraftReminder.expiresAt, '2026-03-09T05:00:00.000Z');
});

test('seven-day choice lasts exactly 168 hours across DST', async () => {
  const r = await run({ now: new Date('2026-10-30T12:00:00Z'), deviceZone: 'America/Chicago',
    pressedButton: '7 天内不再询问' });
  assert.equal(r.writes[0].data.oldDraftReminder.expiresAt, '2026-11-06T12:00:00.000Z');
});

test('active preference silently reuses chosen creation zone without extending expiration', async () => {
  const r = await run({ now: oldNow, state: reminderState(),
    createdAt: new Date('2026-10-19T00:30:00Z') });
  assert.equal(r.prompts.length, 0);
  assert.equal(r.requests[0].data.list, '2026-10-18');
  assert.equal(r.requests[0].data.created, '2026-10-19T00:30:00.000Z');
  assert.equal(r.writes[0].data.oldDraftReminder.expiresAt, '2026-10-21T16:00:00.000Z');
});

test('preference expires at its exact boundary', async () => {
  const r = await run({ now: new Date('2026-10-21T16:00:00Z'), state: reminderState() });
  assert.equal(r.prompts.length, 1);
  assert.equal(r.writes[0].data.oldDraftReminder, undefined);
});

test('device zone change requires confirmation despite an active preference', async () => {
  const r = await run({ now: oldNow, deviceZone: 'Europe/London', state: reminderState() });
  assert.equal(r.prompts.length, 1);
  assert.equal(r.writes[0].data.oldDraftReminder, undefined);
});

test('fresh records use current device zone and preserve an active old-draft preference', async () => {
  const r = await run({ now: oldNow, createdAt: new Date('2026-10-21T11:55:00Z'),
    state: reminderState() });
  assert.equal(r.prompts.length, 0);
  assert.equal(r.requests[0].data.list, '2026-10-21');
  assert.equal(r.writes[0].data.oldDraftReminder.creationZone, 'America/Chicago');
});

test('fresh record sent after device change clears previous old-draft preference', async () => {
  const r = await run({ now: oldNow, createdAt: new Date('2026-10-21T11:55:00Z'),
    deviceZone: 'Europe/London', state: reminderState() });
  assert.equal(r.prompts.length, 1);
  assert.equal(r.writes[0].data.oldDraftReminder, undefined);
});

for (const opts of [{ promptAccepted: false }, { networkError: true },
  { response: { statusCode: 401, success: false } }]) {
  test(`cancel or failed send does not persist suppression: ${JSON.stringify(opts)}`, async () => {
    const r = await run({ now: oldNow, pressedButton: '7 天内不再询问', ...opts });
    assert.equal(r.writes.length, 0);
  });
}

for (const overrides of [{ expiresAt: 'not-a-date' }, { creationZone: 'invalid-zone' },
  { selectedAt: '2026-10-22T00:00:00Z' }]) {
  test(`invalid or future-dated suppression falls back to asking: ${JSON.stringify(overrides)}`, async () => {
    const r = await run({ now: oldNow, state: reminderState(overrides) });
    assert.equal(r.prompts.length, 1);
    assert.equal(r.requests.length, 1);
    assert.deepEqual(r.failures, []);
    assert.equal(r.writes[0].data.oldDraftReminder, undefined);
  });
}

test('one-time send and old v1 state remain compatible', async () => {
  const r = await run({ now: oldNow, state: savedState('Asia/Shanghai') });
  assert.equal(r.prompts.length, 1);
  assert.equal(r.writes[0].data.version, 1);
  assert.equal(r.writes[0].data.oldDraftReminder, undefined);
});

// These cases guard the real action's behavior when host adapters fail.
for (const stage of ['create', 'authorize', 'read']) {
  test(`credential ${stage} failure completes safely without creating or saving`, async () => {
    const r = await run({ credentialFailure: stage });
    assert.equal(r.requests.length, 0);
    assert.equal(r.writes.length, 0);
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0], /凭据/);
    assert.doesNotMatch(JSON.stringify([r.failures, r.errors, r.logs]), /test-secret/);
  });
}

test('HTTP factory failure completes safely before a request or state write', async () => {
  const r = await run({ httpCreateFailure: true });
  assert.equal(r.requests.length, 0);
  assert.equal(r.writes.length, 0);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /发送/);
  assert.doesNotMatch(JSON.stringify([r.failures, r.errors, r.logs]), /test-secret/);
});

test('missing HTTP response fails once without retrying or saving state', async () => {
  const r = await run({ response: null });
  assert.equal(r.requests.length, 1);
  assert.equal(r.writes.length, 0);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /发送/);
  assert.doesNotMatch(JSON.stringify([r.failures, r.errors, r.logs]), /test-secret/);
});
