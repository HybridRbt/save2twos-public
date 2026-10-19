const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'save2twos.js'), 'utf8');

// Drafts APIs only exist in the app. Execute the actual action with boundary stubs.
async function run({ content = '一条笔记', authorized = true, values = {}, response,
  networkError = false } = {}) {
  const result = { requests: [], errors: [], failures: [], canceled: 0, completed: 0,
    logs: [], passwordFields: [] };
  const credentials = { api: 'https://example.invalid/capture', user_id: 'test-user',
    token: 'test-secret', ...values };
  const draft = { content, tags: ['private'] };
  const sandbox = {
    draft,
    Credential: { create: () => ({
      addTextField() {},
      addPasswordField(key) { result.passwordFields.push(key); },
      authorize: () => authorized,
      getValue: (key) => credentials[key],
    }) },
    HTTP: { create: () => ({ request(options) {
      result.requests.push(options);
      if (networkError) throw new Error('Network failed: test-secret');
      return response || { statusCode: 200, success: true };
    } }) },
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

test('adds source tag while preserving original draft and request credentials', async () => {
  const r = await run({ content: '正文\n第二行  ' });
  assert.equal(r.requests[0].data.text, '正文\n第二行   #drafts');
  assert.equal(r.draft.content, '正文\n第二行  ');
  assert.deepEqual(r.draft.tags, ['private']);
  assert.equal(r.requests[0].data.token, 'test-secret');
  assert.equal(r.requests[0].data.user_id, 'test-user');
  assert.equal(r.requests[0].url, 'https://example.invalid/capture');
  assert.equal(r.requests[0].method, 'POST');
  assert.deepEqual(r.failures, []);
});

for (const content of ['#drafts', '正文 #drafts', '#DRAFTS\n正文']) {
  test(`does not duplicate standalone source tag: ${JSON.stringify(content)}`, async () => {
    const r = await run({ content });
    assert.equal(r.requests[0].data.text, content);
  });
}

for (const content of ['#draftsmanship', 'https://example.invalid/#drafts', '#drafts中文']) {
  test(`does not mistake a substring for source tag: ${content}`, async () => {
    const r = await run({ content });
    assert.equal(r.requests[0].data.text, `${content} #drafts`);
  });
}

test('canceling credentials sends nothing', async () => {
  const r = await run({ authorized: false });
  assert.equal(r.requests.length, 0);
  assert.equal(r.canceled, 1);
});

for (const field of ['api', 'user_id', 'token']) {
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

test('token input is hidden', async () => {
  const r = await run();
  assert.ok(r.passwordFields.includes('token'));
});
