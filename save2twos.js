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

  // Match a standalone tag, not a URL fragment or a longer tag name.
  const content = /(^|\s)#drafts(?=\s|$)/i.test(draft.content)
    ? draft.content
    : draft.content + ' #drafts';
  putMemo(cred, content);
}

function putMemo(cred, content) {
  const http = HTTP.create();
  const data = {
    text: content,
    user_id: cred.user_id,
    token: cred.token
  };
  let response;
  try {
    response = http.request({
      url: cred.api,
      method: 'POST',
      data: data,
      headers: { Accept: 'application/json' }
    });
  } catch (_) {
    throw new Error('发送到 Twos 失败，请检查网络和 API 配置');
  }

  // Keep the original endpoint's HTTP 200 contract; do not retry creates.
  if (response.statusCode !== 200) {
    const status = Number(response.statusCode);
    throw new Error(Number.isInteger(status) && status > 0
      ? '发送到 Twos 失败（HTTP ' + status + '）'
      : '发送到 Twos 失败，请检查网络和 API 配置');
  }
}

function getCredential() {
  const credential = Credential.create('Post to Twos', 'Add API info');
  credential.addTextField('api', 'API URL');
  credential.addTextField('user_id', 'User ID');
  credential.addPasswordField('token', 'Token');
  if (!credential.authorize()) {
    return null;
  }

  const cred = {
    api: credential.getValue('api'),
    user_id: credential.getValue('user_id'),
    token: credential.getValue('token')
  };
  if (!Object.values(cred).every((value) => typeof value === 'string' && value.trim())) {
    return null;
  }
  return cred;
}

main()
  .then(() => script.complete())
  .catch((err) => {
    context.fail(err.message);
    script.complete();
  });
