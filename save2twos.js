// See online documentation for examples
// https://docs.getdrafts.com/docs/actions/scripting

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

  // Match a standalone tag, not a URL fragment or a longer tag name.
  const content = /(^|\s)#drafts(?=\s|$)/i.test(draft.content)
    ? draft.content
    : draft.content + ' #drafts';
  putMemo(cred, content, createdAt);
}

function putMemo(cred, content, createdAt) {
  const http = HTTP.create();
  const data = {
    text: content,
    tags: ['drafts'],
    created: createdAt.toISOString(),
    list: createdAt.getFullYear() + '-' + String(createdAt.getMonth() + 1).padStart(2, '0')
      + '-' + String(createdAt.getDate()).padStart(2, '0')
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
