import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { createNotionTutorResolver, createTutorSyncHandler, createTutorUnlinkHandler, createTutorStatusHandler, TutorSyncError, TUTOR_DATABASE_ID } from '../src/notion-tutor-sync.js';
import { createSsoHandler } from '../src/sso.js';
import { ensureNotionTutorApprovalColumn } from '../src/tutor-mapping.js';
import { DatabaseSync } from 'node:sqlite';

const sourceId = '123456781234123412341234567890ab';
const email = 'fixture@example.invalid';
const source = { properties: { 'メールアドレス': { id: 'email-id', type: 'email' }, 'Notion名': { id: 'name-id', type: 'rich_text' } } };
test('schema diagnostics identify fixed configuration categories without querying people', async () => {
  for (const [property, type, code] of [
    ['メールアドレス', null, 'schema_email_missing'],
    ['Notion名', null, 'schema_tutor_missing'],
    ['メールアドレス', 'relation', 'schema_email_type'],
    ['Notion名', 'relation', 'schema_tutor_type'],
  ]) {
    const schema = structuredClone(source);
    if (type) schema.properties[property].type = type;
    else delete schema.properties[property];
    const f = fixture({ schema });
    await assert.rejects(f.resolve.checkConfiguration(), error => error.code === code);
    assert.equal(f.calls.some(call => call.url.pathname.endsWith('/query')), false);
  }
});
const row = (address = email, name = 'Fixture Tutor') => ({ id: 'fixture-page', properties: {
  'メールアドレス': { id: 'email-id', type: 'email', email: address },
  'Notion名': { id: 'name-id', type: 'rich_text', rich_text: [{ plain_text: name }] },
} });
function fixture({ result = { results: [row()], has_more: false }, nameResult, roster, userProfiles = {}, schema = source, database = { data_sources: [{ id: sourceId }] }, env = {}, failure } = {}) {
  const calls = [];
  const resolve = createNotionTutorResolver({ env: { NOTION_API_KEY: 'PRIVATE_FIXTURE', ...env }, fetchImplementation: async (url, options) => {
    calls.push({ url: new URL(url), options });
    assert.equal(new URL(url).origin, 'https://api.notion.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Notion-Version'], '2025-09-03');
    if (failure) throw new Error('PRIVATE_FIXTURE: RAW_PERSONAL_RESPONSE');
    const body = options.body && JSON.parse(options.body);
    const isNameQuery = body?.filter?.property === 'name-id';
    const data = url.includes('/users/') ? userProfiles[url.split('/').at(-1)] || {} : url.includes('/query?') ? (body && !body.filter && roster ? roster(body) : isNameQuery && nameResult ? nameResult : result) : url.includes('/data_sources/') ? schema : database;
    return new Response(JSON.stringify(data), { status: typeof data === 'number' ? data : 200 });
  } });
  return { resolve, calls };
}

test('discovers source and filters by exact account email, retrieving only the two properties', async () => {
  const f = fixture();
  assert.equal(await f.resolve(email), 'Fixture Tutor');
  assert.ok(f.calls[0].url.pathname.endsWith(TUTOR_DATABASE_ID));
  const query = f.calls[2];
  assert.deepEqual(JSON.parse(query.options.body), { page_size: 2, filter: { property: 'email-id', email: { equals: email } } });
  assert.deepEqual(query.url.searchParams.getAll('filter_properties'), ['email-id', 'name-id']);
  assert.equal(await f.resolve(email), 'Fixture Tutor');
  assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/query')).length, 4);
});

test('read-only connection check reads schema without requesting people rows', async () => {
  const f = fixture();
  assert.equal((await f.resolve.checkConfiguration()).connected, true);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(c => c.options.method === 'GET'));
});

const peopleSchema = { properties: { ...source.properties, 'Notion名': { id: 'name-id', type: 'people' } } };
function peopleRow(address = email, personName = 'Fixture Tutor', personId = 'person-1', pageId = 'fixture-page') {
  const value = row(address);
  value.id = pageId;
  value.properties['Notion名'] = { id: 'name-id', type: 'people', people: [{ object: 'user', id: personId, type: 'person', name: personName }] };
  return value;
}
test('people property resolves one display name and checks paginated name collisions', async () => {
  const target = peopleRow();
  const f = fixture({ schema: peopleSchema, result: { results: [target] }, roster: body => body.start_cursor
    ? { results: [target], has_more: false }
    : { results: [peopleRow('other@example.invalid', 'Other Tutor', 'person-2', 'other-page')], has_more: true, next_cursor: 'next' } });
  assert.equal(await f.resolve(email), 'Fixture Tutor');
  const scans = f.calls.filter(c => c.options.body && !JSON.parse(c.options.body).filter);
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[0].url.searchParams.getAll('filter_properties'), ['email-id', 'name-id']);
});
test('people schema check does not retrieve user records', async () => {
  const f = fixture({ schema: peopleSchema });
  assert.equal((await f.resolve.checkConfiguration()).connected, true);
  assert.equal(f.calls.length, 2);
});
test('empty, multiple, partial, bot and truncated people properties fail closed', async () => {
  for (const value of [[], [{ id: 'person-1' }], [{ id: 'person-1', type: 'bot', name: 'Bot' }],
    [peopleRow().properties['Notion名'].people[0], peopleRow().properties['Notion名'].people[0]]]) {
    const target = peopleRow();
    target.properties['Notion名'].people = value;
    await assert.rejects(fixture({ schema: peopleSchema, result: { results: [target] } }).resolve(email), e => e.code === 'invalid_person');
  }
  const target = peopleRow();
  target.properties['Notion名'].has_more = true;
  await assert.rejects(fixture({ schema: peopleSchema, result: { results: [target] } }).resolve(email), e => e.code === 'invalid_person');
});
test('same people display name under another account or user ID never grants access', async () => {
  for (const personId of ['person-1', 'different-person']) {
    const target = peopleRow();
    const f = fixture({ schema: peopleSchema, result: { results: [target] }, roster: () => ({ results: [target, peopleRow('other@example.invalid', 'Fixture Tutor', personId, 'other-page')] }) });
    await assert.rejects(f.resolve(email), e => e.code === 'ambiguous_name');
  }
});
test('missing current row, unknown profiles, repeated cursors and oversized people roster fail closed', async () => {
  const target = peopleRow();
  const unknownProfile = peopleRow('other@example.invalid', 'Other Tutor', sourceId, 'other-page');
  delete unknownProfile.properties['Notion名'].people[0].name;
  for (const [roster, code] of [
    [() => ({ results: [] }), 'ambiguous_name'],
    [() => ({ results: [target, unknownProfile] }), 'roster_profile'],
    [() => ({ results: [], has_more: true, next_cursor: 'same' }), 'upstream'],
    [body => ({ results: [], has_more: true, next_cursor: String(Number(body.start_cursor || 0) + 1) }), 'roster_limit'],
  ]) {
    await assert.rejects(fixture({ schema: peopleSchema, result: { results: [target] }, roster }).resolve(email), e => e.code === code);
  }
});

test('partial unrelated profiles are retrieved transiently and name collisions still fail', async () => {
  const target = peopleRow();
  const partial = peopleRow('other@example.invalid', 'Other Tutor', sourceId, 'other-page');
  delete partial.properties['Notion名'].people[0].name;
  for (const name of ['Other Tutor', 'Fixture Tutor']) {
    const f = fixture({ schema: peopleSchema, result: { results: [target] },
      roster: () => ({ results: [target, partial] }), userProfiles: { [sourceId]: { id: sourceId, name } } });
    if (name === 'Other Tutor') assert.equal(await f.resolve(email), 'Fixture Tutor');
    else await assert.rejects(f.resolve(email), e => e.code === 'ambiguous_name');
    assert.equal(f.calls.filter(c => c.url.pathname.includes('/users/')).length, 1);
  }
});

test('unavailable user identifies a validated roster row without exposing profile data', async () => {
  const target = peopleRow();
  const pageId = 'abcdefab123412341234abcdefabcdef';
  const partial = peopleRow('private@example.invalid', 'Private Tutor', sourceId, pageId);
  delete partial.properties['Notion名'].people[0].name;
  const f = fixture({ schema: peopleSchema, result: { results: [target] },
    roster: () => ({ results: [target, partial] }), userProfiles: { [sourceId]: 404 } });
  await assert.rejects(f.resolve(email), e => {
    assert.equal(e.code, 'profile_not_found');
    assert.equal(e.remediationUrl, 'https://www.notion.so/' + pageId);
    assert.equal(e.message.includes('private@example.invalid'), false);
    assert.equal(e.message.includes('Private Tutor'), false);
    return true;
  });
});

test('an unrelated named bot does not block a person, but a same-name bot fails closed', async () => {
  const target = peopleRow();
  for (const name of ['Other Bot', 'Fixture Tutor']) {
    const botRow = peopleRow('bot@example.invalid', name, 'bot-id', 'bot-page');
    botRow.properties['Notion名'].people[0].type = 'bot';
    const f = fixture({ schema: peopleSchema, result: { results: [target] }, roster: () => ({ results: [target, botRow] }) });
    if (name === 'Other Bot') assert.equal(await f.resolve(email), 'Fixture Tutor');
    else await assert.rejects(f.resolve(email), e => e.code === 'ambiguous_name');
  }
});

for (const result of [{ results: [], has_more: false }, { results: [row('other@example.invalid')], has_more: false }, { results: [{ ...row(), archived: true }], has_more: false }]) {
  test('missing, different-case/nonmatching or archived entry never grants a fallback mapping', async () => {
    assert.equal(await fixture({ result }).resolve(email), null);
  });
}
for (const result of [{ results: [row(), row()], has_more: false }, { results: [row()], has_more: true }]) {
  test('duplicate and truncated query results fail closed even with the same tutor name', async () => {
    await assert.rejects(fixture({ result }).resolve(email), error => error.code === 'ambiguous');
  });
}
for (const name of ['', 'Tutor,Other', 'Tutor\nOther', 'a'.repeat(101)]) {
  test('empty, multiple or malformed tutor names are rejected', async () => {
    await assert.rejects(fixture({ result: { results: [row(email, name)] } }).resolve(email), error => error.code === 'invalid_name');
  });
}
test('supports text email properties and title tutor names without fuzzy matching', async () => {
  const f = fixture({ schema: { properties: { 'メールアドレス': { id: 'email-id', type: 'rich_text' }, 'Notion名': { id: 'name-id', type: 'title' } } },
    result: { results: [{ id: 'fixture-page', properties: { 'メールアドレス': { type: 'rich_text', rich_text: [{ plain_text: email }] }, 'Notion名': { type: 'title', title: [{ text: { content: 'Fixture Tutor' } }] } } }] } });
  assert.equal(await f.resolve(email), 'Fixture Tutor');
  assert.deepEqual(JSON.parse(f.calls[2].options.body).filter, { property: 'email-id', rich_text: { equals: email } });
});
test('bad configuration, ambiguous sources and invalid schema do not select arbitrary grants', async () => {
  await assert.rejects(fixture({ env: { NOTION_API_KEY: '' } }).resolve(email), error => error.code === 'configuration');
  await assert.rejects(fixture({ database: { data_sources: [{ id: sourceId }, { id: sourceId }] } }).resolve(email), error => error.code === 'configuration');
  await assert.rejects(fixture({ schema: { properties: {} } }).resolve(email), error => error.code === 'schema_email_missing');
  const f = fixture();
  await assert.rejects(f.resolve('not-an-email'), error => error.code === 'account_email');
  assert.equal(f.calls.length, 0);
});
test('network errors never expose request headers, credential values or raw responses', async () => {
  await assert.rejects(fixture({ failure: true }).resolve(email), error => {
    assert.ok(error instanceof TutorSyncError);
    assert.equal(error.message.includes('PRIVATE_FIXTURE'), false);
    assert.equal(error.message.includes('RAW_PERSONAL_RESPONSE'), false);
    return true;
  });
});

function adminFixture(role, resolved = 'Fixture Tutor') {
  const writes = [], lookedUp = [];
  const db = { prepare: sql => ({ get: () => ({ id: 2, username: email, role: 'crew' }), run: (...params) => { writes.push(params); return { changes: 1 }; } }) };
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 1, role }); await next(); });
  app.post('/users/:id/sync', createTutorSyncHandler({ db, resolveTutorName: async name => { lookedUp.push(name); return resolved; } }));
  return { writes, lookedUp, request: (headers = {}) => app.request('/users/2/sync', { method: 'POST', headers: { Origin: 'https://wannav-main.onrender.com', 'X-WannaV-Request': '1', ...headers }, body: JSON.stringify({ username: 'attacker@example.invalid', tutorName: 'Forged' }) }) };
}

test('account diagnosis returns only safe outcomes, requires admin, and never writes', async () => {
  for (const role of ['admin', 'leader', 'crew']) {
    for (const outcome of ['PRIVATE_TUTOR', null, new TutorSyncError('rate_limit'), new Error('PRIVATE_RESPONSE')]) {
      let calls = 0;
      const db = { prepare: () => ({ get: () => ({ id: 2, username: email, role: 'crew' }), run: () => assert.fail('diagnosis must not write') }) };
      const app = new Hono();
      app.use('*', async (c, next) => { c.set('user', { role }); await next(); });
      app.get('/users/:id/status', createTutorStatusHandler({ db, resolveTutorName: async username => {
        calls++; assert.equal(username, email);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      } }));
      const response = await app.request('/users/2/status');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const text = await response.text();
      assert.equal(text.includes('PRIVATE'), false);
      assert.equal(text.includes(email), false);
      if (role !== 'admin') { assert.equal(response.status, 403); assert.equal(calls, 0); }
      else {
        assert.equal(calls, 1);
        const value = JSON.parse(text);
        assert.equal(value.reason, outcome instanceof Error ? (outcome.code || 'upstream') : outcome === null ? 'email_not_matched' : 'matched');
      }
    }
  }
});
test('admin sync uses the stored account, ignores forged input and clears mapping on no match', async () => {
  for (const value of ['Fixture Tutor', null]) {
    const f = adminFixture('admin', value);
    assert.equal((await f.request()).status, 200);
    assert.deepEqual(f.lookedUp, [email]);
    assert.deepEqual(f.writes, [[value, value === null ? 0 : 1, 2, email]]);
  }
});
test('crew, leader and foreign-origin requests cannot sync or write mappings', async () => {
  for (const role of ['crew', 'leader']) {
    const f = adminFixture(role);
    assert.equal((await f.request()).status, 403);
    assert.equal(f.writes.length, 0);
  }
  const f = adminFixture('admin');
  assert.equal((await f.request({ Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await f.request({ 'X-WannaV-Request': '' })).status, 403);
  assert.equal(f.lookedUp.length, 0);
});

test('extension SSO syncs authoritative name before signing; missing/error never reuses old local name', async () => {
  const secret = randomBytes(48).toString('hex');
  for (const value of ['Synced Tutor', null, new TutorSyncError('upstream')]) {
    const writes = [];
    const db = { prepare: sql => ({ all: () => [{ id: 1, url: 'https://extended-management.onrender.com/', required_role: 'crew' }],
      get: () => sql.includes('SELECT tutor_name') ? { tutor_name: 'Stale Tutor', notion_tutor_approved: 1 } : { id: 7, username: email, role: 'crew', notion_tutor_approved: 1 }, run: (...args) => writes.push(args) }) };
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('user', { id: 7, username: email, role: 'crew' }); await next(); });
    app.post('/sso', createSsoHandler({ db, secret, resolveTutorName: async username => { assert.equal(username, email); if (value instanceof Error) throw value; return value; } }));
    const response = await app.request('/sso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemId: 1, tutorName: 'Forged' }) });
    const data = await response.json();
    if (typeof value === 'string') {
      assert.equal(response.status, 200);
      assert.equal(jwt.verify(data.token, secret).tutorName, 'Synced Tutor');
    } else {
      assert.equal(response.status, value === null ? 403 : 503);
      assert.equal(data.token, undefined);
    }
  }
});

test('same tutor name on another email row is ambiguous and never grants access', async () => {
  const f = fixture({ nameResult: { results: [row(), { ...row('other@example.invalid'), id: 'other-page' }] } });
  await assert.rejects(f.resolve(email), error => error.code === 'ambiguous_name');
});

test('new approval migration preserves existing users as unapproved and is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT); INSERT INTO users VALUES (1, \'fixture\')');
    ensureNotionTutorApprovalColumn(db); ensureNotionTutorApprovalColumn(db);
    assert.equal(db.prepare('SELECT notion_tutor_approved FROM users WHERE id=1').get().notion_tutor_approved, 0);
  } finally { db.close(); }
});

test('leader-created or otherwise unapproved crew cannot auto-link from an email alone', async () => {
  let lookups = 0;
  const db = { prepare: () => ({ all: () => [{ id: 1, url: 'https://extended-management.onrender.com/', required_role: 'crew' }], get: () => ({ tutor_name: 'Old', notion_tutor_approved: 0 }) }) };
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 7, username: email, role: 'crew' }); await next(); });
  app.post('/sso', createSsoHandler({ db, secret: randomBytes(48).toString('hex'), resolveTutorName: async () => { lookups++; return 'Tutor'; } }));
  const response = await app.request('/sso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemId: 1 }) });
  assert.equal(response.status, 403);
  assert.equal(lookups, 0);
  assert.equal((await response.json()).token, undefined);
});

test('only admin can unlink and block future automatic SSO synchronization', async () => {
  for (const role of ['admin', 'leader', 'crew']) {
    const writes = [];
    const db = { prepare: sql => ({ run: id => { assert.match(sql, /notion_tutor_approved = 0/); writes.push(id); } }) };
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('user', { role }); await next(); });
    app.delete('/users/:id/sync', createTutorUnlinkHandler({ db }));
    const response = await app.request('/users/2/sync', { method: 'DELETE', headers: { Origin: 'https://wannav-main.onrender.com', 'X-WannaV-Request': '1' } });
    assert.equal(response.status, role === 'admin' ? 200 : 403);
    assert.equal(writes.length, role === 'admin' ? 1 : 0);
  }
});

test('missing resolver never falls back to a stale stored tutor for extension SSO', async () => {
  const db = { prepare: () => ({ all: () => [{ id: 1, url: 'https://extended-management.onrender.com/', required_role: 'crew' }], get: () => ({ tutor_name: 'Stale Tutor', notion_tutor_approved: 1 }) }) };
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 7, username: email, role: 'crew' }); await next(); });
  app.post('/sso', createSsoHandler({ db, secret: randomBytes(48).toString('hex') }));
  const response = await app.request('/sso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemId: 1 }) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).token, undefined);
});

test('HTTP authorization and rate-limit failures expose only safe error categories', async () => {
  for (const [status, code] of [[401, 'credentials'], [403, 'permissions'], [404, 'not_found'], [429, 'rate_limit']]) {
    const resolve = createNotionTutorResolver({ env: { NOTION_API_KEY: 'PRIVATE_FIXTURE' }, fetchImplementation: async () =>
      new Response(JSON.stringify({ message: 'RAW_PERSONAL_RESPONSE' }), { status }) });
    await assert.rejects(resolve(email), error => error.code === code && !error.message.includes('RAW_PERSONAL_RESPONSE'));
  }
});
