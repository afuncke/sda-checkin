'use strict';
process.env.DB_FILE = ':memory:';
process.env.PRESENTER_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert');
const { server } = require('../server.js');

let base;
test.before(() => new Promise(r => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
test.after(() => { server.closeAllConnections(); server.close(); });

const call = async (method, path, body, key) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Presenter-Key': key } : {}) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('full round: vote, sealed box, reveal, closed, new round', async () => {
  let r = await call('GET', '/api/round');
  assert.equal(r.status, 200);
  assert.equal(r.body.revealed, false);
  const id = r.body.id;

  assert.equal((await call('POST', '/api/entries', { round: id, value: 7, desc: '  hours slept ', guess: 6 })).status, 201);
  assert.equal((await call('POST', '/api/entries', { round: id, value: 'x', guess: 6 })).status, 400);

  r = await call('GET', '/api/round');
  assert.equal(r.body.count, 1);
  assert.equal(r.body.entries, undefined, 'entries stay sealed before the reveal');

  assert.equal((await call('PATCH', '/api/round', { revealed: true })).status, 403);
  assert.equal((await call('PATCH', '/api/round', { revealed: true }, 'wrong')).status, 403);
  r = await call('PATCH', '/api/round', { revealed: true, prompt: 'Coffees today?' }, 'test-key');
  assert.equal(r.status, 200);
  assert.equal(r.body.prompt, 'Coffees today?');
  assert.deepEqual(r.body.entries.map(e => [e.value, e.desc, e.guess]), [[7, 'hours slept', 6]]);

  assert.equal((await call('POST', '/api/entries', { round: id, value: 1, guess: 1 })).status, 409, 'box closed after reveal');

  r = await call('POST', '/api/round', {}, 'test-key');
  assert.notEqual(r.body.id, id);
  assert.equal(r.body.prompt, 'Coffees today?');
  assert.equal(r.body.count, 0);
  assert.equal((await call('POST', '/api/entries', { round: id, value: 1, guess: 1 })).status, 409, 'stale round rejected');

  r = await call('POST', '/api/round', { demo: true }, 'test-key');
  assert.equal(r.body.count, 20);
});

test('presenter check and static files', async () => {
  assert.equal((await call('GET', '/api/presenter', null, 'test-key')).status, 200);
  assert.equal((await call('GET', '/api/presenter')).status, 403);
  const html = await fetch(base + '/');
  assert.match(await html.text(), /Quantified SD&amp;A/);
  assert.equal((await fetch(base + '/server.js')).status, 404);
});
