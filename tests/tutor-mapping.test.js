import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createUserManagementHandlers } from '../src/user-management.js';
import { ensureTutorNameColumn, parseTutorName } from '../src/tutor-mapping.js';

function fixture(role, targetRole = 'crew') {
  const writes = [];
  const db = { prepare: sql => ({ get: () => ({ id: 2, role: targetRole }), run: (...args) => writes.push({ sql, args }) }) };
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 1, role }); await next(); });
  app.put('/users/:id/tutor', createUserManagementHandlers({ db, bcrypt: {} }).tutor);
  return { writes, request: tutorName => app.request('/users/2/tutor', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tutorName, role: 'admin' }) }) };
}

test('only admin can register or clear crew mapping', async () => {
  const f = fixture('admin');
  assert.equal((await f.request(' Assigned Tutor ')).status, 200);
  assert.deepEqual(f.writes[0].args, ['Assigned Tutor', 2]);
  assert.equal((await f.request('   ')).status, 200);
  assert.deepEqual(f.writes[1].args, [null, 2]);
});
for (const role of ['crew', 'leader', 'unknown']) {
  test(`${role} cannot change mapping through forged request`, async () => {
    const f = fixture(role);
    assert.equal((await f.request('Other Tutor')).status, 403);
    assert.equal(f.writes.length, 0);
  });
}
test('non-crew targets and malformed mappings are rejected', async () => {
  assert.equal((await fixture('admin', 'leader').request('Tutor')).status, 400);
  const f = fixture('admin');
  for (const value of [42, {}, ['Tutor'], 'a'.repeat(101), 'Tutor\nOther', 'Tutor, Other', 'Tutor\u200b']) {
    assert.equal((await f.request(value)).status, 400);
  }
  assert.equal(f.writes.length, 0);
  assert.equal(parseTutorName(null).value, null);
});
test('migration adds nullable mapping once and propagates errors', () => {
  let columns = [{ name: 'id' }];
  let calls = 0;
  const db = { prepare: () => ({ all: () => columns }), exec: sql => { assert.equal(sql, 'ALTER TABLE users ADD COLUMN tutor_name TEXT'); calls++; columns.push({ name: 'tutor_name' }); } };
  ensureTutorNameColumn(db);
  ensureTutorNameColumn(db);
  assert.equal(calls, 1);
  assert.throws(() => ensureTutorNameColumn({ prepare: () => { throw new Error('failure'); } }), /failure/);
});
