import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { readJwtSecret, canCreateUser, canManageUser } from '../src/security.js';
import { createUserManagementHandlers } from '../src/user-management.js';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

test('JWT secret is mandatory and rejects public fallback and short values', () => {
  for (const value of [undefined, '', ' '.repeat(40), 'short', 'wannav-secret-key-change-in-production']) {
    assert.throws(() => readJwtSecret({ JWT_SECRET: value }), /JWT_SECRET/);
  }
  const secret = 'test-only-not-production-'.repeat(3);
  assert.equal(readJwtSecret({ JWT_SECRET: secret }), secret);
});

test('missing JWT configuration exits before DB initialization and HTTP startup', () => {
  const result = spawnSync(process.execPath, ['src/index.js'], {
    env: { ...process.env, JWT_SECRET: '' }, encoding: 'utf8', timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET must be configured/);
  assert.equal(existsSync(new URL('../data/wannav.db', import.meta.url)), false);
});

test('role policy refuses unknown actors and prevents leader peer/admin control', () => {
  for (const role of ['admin', 'leader', 'crew']) {
    assert.equal(canCreateUser({ role: 'admin' }, role), true);
    assert.equal(canManageUser({ role: 'admin' }, { role }), true);
    assert.equal(canCreateUser({ role: 'leader' }, role), role === 'crew');
    assert.equal(canManageUser({ role: 'leader' }, { role }), role === 'crew');
    assert.equal(canCreateUser({ role: 'crew' }, role), false);
    assert.equal(canManageUser({ role: 'crew' }, { role }), false);
  }
  assert.equal(canCreateUser(null, 'crew'), false);
  assert.equal(canManageUser({ role: 'admin' }, { role: 'unknown' }), false);
});

function fixture(actorRole, targetRole = 'admin', targetName = 'other') {
  const calls = [];
  const target = targetRole === null ? undefined : { id: 2, username: targetName, role: targetRole };
  const db = { prepare(sql) { return {
    get() { calls.push(['get', sql]); return /SELECT id FROM users WHERE username/.test(sql) ? undefined : target; },
    run(...args) { calls.push(['write', sql, ...args]); return { lastInsertRowid: 3 }; },
  }; } };
  const bcrypt = { hashSync() { calls.push(['hash']); return 'test-hash'; } };
  const handlers = createUserManagementHandlers({ db, bcrypt });
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 1, role: actorRole }); await next(); });
  app.post('/users', handlers.create);
  app.put('/users/:id/password', handlers.password);
  app.delete('/users/:id', handlers.remove);
  return { app, calls };
}

for (const targetRole of ['admin', 'leader']) {
  test(`leader cannot create ${targetRole} or perform account writes`, async () => {
    const { app, calls } = fixture('leader');
    const r = await app.request('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'candidate', role: targetRole }) });
    assert.equal(r.status, 403);
    assert.equal(calls.some(c => c[0] === 'write' || c[0] === 'hash'), false);
  });
  for (const method of ['PUT', 'DELETE']) {
    test(`leader cannot ${method} ${targetRole}, including session invalidation`, async () => {
      const { app, calls } = fixture('leader', targetRole);
      const r = await app.request('/users/2' + (method === 'PUT' ? '/password' : ''), {
        method, headers: { 'Content-Type': 'application/json' }, ...(method === 'PUT' ? { body: JSON.stringify({ password: 'test-only' }) } : {}),
      });
      assert.equal(r.status, 403);
      assert.equal(calls.some(c => c[0] === 'write' || c[0] === 'hash'), false);
    });
  }
}

test('leader can still create crew', async () => {
  const { app, calls } = fixture('leader');
  const r = await app.request('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'candidate', role: 'crew' }) });
  assert.equal(r.status, 200);
  assert.equal(calls.filter(c => c[0] === 'write').length, 1);
});

for (const actor of ['admin', 'leader']) {
  for (const method of ['PUT', 'DELETE']) {
    test(`${actor} can ${method} crew and invalidates sessions`, async () => {
      const { app, calls } = fixture(actor, 'crew');
      const r = await app.request('/users/2' + (method === 'PUT' ? '/password' : ''), {
        method, headers: { 'Content-Type': 'application/json' }, ...(method === 'PUT' ? { body: JSON.stringify({ password: 'test-only' }) } : {}),
      });
      assert.equal(r.status, 200);
      assert.equal(calls.some(c => c[0] === 'write' && /DELETE FROM sessions/.test(c[1])), true);
    });
  }
}

test('admin can create admin', async () => {
  const { app } = fixture('admin');
  const r = await app.request('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'candidate', role: 'admin' }) });
  assert.equal(r.status, 200);
});

test('admin can reset another admin account', async () => {
  const { app, calls } = fixture('admin', 'admin');
  const r = await app.request('/users/2/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-only' }) });
  assert.equal(r.status, 200);
  assert.equal(calls.some(c => c[0] === 'write' && /DELETE FROM sessions/.test(c[1])), true);
});

test('missing target is 404 and default admin deletion remains blocked', async () => {
  let f = fixture('admin', null);
  assert.equal((await f.app.request('/users/2', { method: 'DELETE' })).status, 404);
  f = fixture('admin', 'admin', 'admin');
  assert.equal((await f.app.request('/users/2', { method: 'DELETE' })).status, 400);
  assert.equal(f.calls.some(c => c[0] === 'write'), false);
});
