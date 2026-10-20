const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'save2twos.js'), 'utf8');

// Drafts APIs only exist in the app. Execute the actual action with boundary stubs.
async function run({ content = '一条笔记', authorized = true, values = {}, response,
  networkError = false, createdAt = new Date('2026-10-19T11:23:45+08:00') } = {}) {
  const result = { requests: [], errors: [], failures: [], canceled: 0, completed: 0,
    logs: [], passwordFields: [] };
  const credentials = { api_key: 'test-secret', ...values };
  const draft = { content, tags: ['private'], createdAt };
  const sandbox = {
    draft,
    Credential: { create: (identifier) => { result.credentialIdentifier = identifier; return ({
      addTextField() {},
      addPasswordField(key) { result.passwordFields.push(key); },
      authorize: () => authorized,
      getValue: (key) => credentials[key],
    }); } },
    HTTP: { create: () => ({ request(options) {
      result.requests.push(options);
      if (networkError) throw new Error('Network failed: test-secret');
      return response || { statusCode: 201, success: true };
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

test('uses official v1 JSON request and Bearer key while preserving original draft', async () => {
  const r = await run({ content: '正文\n第二行  ' });
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].data.text, '正文\n第二行   #drafts');
  assert.equal(r.draft.content, '正文\n第二行  ');
  assert.deepEqual(r.draft.tags, ['private']);
  assert.equal(r.requests[0].data.token, undefined);
  assert.equal(r.requests[0].data.user_id, undefined);
  assert.deepEqual(Array.from(r.requests[0].data.tags), ['drafts']);
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
    const r = await run({ createdAt });
    assert.equal(r.requests[0].data.list, '2026-10-19');
    assert.equal(r.requests[0].data.created, createdAt.toISOString());
  });
}
