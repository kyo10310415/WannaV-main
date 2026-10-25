import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createSsoHandler } from '../src/sso.js';

const secret = 'test-only-sso-key-'.repeat(4);
function fixture(role, systems = [{ id: 1, url: 'https://service.example.test/', required_role: 'leader' }]) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 7, username: 'test-user', role }); await next(); });
  app.post('/sso', createSsoHandler({ secret, db: { prepare: () => ({ all: () => systems, get: () => ({ tutor_name: 'Assigned Tutor' }) }) } }));
  return body => app.request('/sso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
for (const role of ['crew', 'unknown', 'constructor', null]) {
  test(`${role} cannot mint SSO for leader-only service`, async () => {
    const r = await fixture(role)({ targetUrl: 'https://service.example.test/' });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).token, undefined);
  });
}
for (const role of ['admin', 'leader']) {
  test(`${role} receives correctly scoped token by system ID`, async () => {
    const r = await fixture(role)({ systemId: 1, targetUrl: 'https://attacker.example.test/' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const claims = jwt.verify((await r.json()).token, secret, {
      algorithms: ['HS256'], issuer: 'https://wannav-main.onrender.com', audience: 'https://service.example.test'
    });
    assert.equal(claims.role, role);
    assert.equal(claims.targetUrl, 'https://service.example.test/');
  });
}
test('legacy exact URL remains supported while arbitrary destinations are rejected', async () => {
  const request = fixture('leader');
  assert.equal((await request({ targetUrl: 'https://service.example.test/' })).status, 200);
  for (const body of [{}, { targetUrl: 'https://attacker.example.test/' }, { targetUrl: 'https://service.example.test/?x=1' }, { systemId: '1' }]) {
    assert.equal((await request(body)).status, 400);
  }
});
test('duplicate legacy registration cannot bypass the stronger role', async () => {
  const systems = ['crew', 'admin'].map((required_role, i) => ({ id: i+1, url: 'https://service.example.test/', required_role }));
  assert.equal((await fixture('crew', systems)({ targetUrl: systems[0].url })).status, 403);
});
test('unknown required roles and insecure destinations fail closed', async () => {
  assert.equal((await fixture('admin', [{ id: 1, url: 'https://service.example.test/', required_role: 'typo' }])({ systemId: 1 })).status, 403);
  for (const url of ['http://service.example.test/', 'https://user:pass@service.example.test/', 'https://service.example.test/?query=yes', 'invalid']) {
    assert.equal((await fixture('admin', [{ id: 1, url, required_role: 'crew' }])({ systemId: 1 })).status, 400);
  }
});


test('crew SSO signs stored assignment and ignores request supplied tutor', async () => {
  const response = await fixture('crew', [{ id: 1, url: 'https://service.example.test/', required_role: 'crew' }])({ systemId: 1, tutorName: 'Forged Tutor' });
  const claims = jwt.verify((await response.json()).token, secret);
  assert.equal(claims.tutorName, 'Assigned Tutor');
});

test('unregistered mapping is null without guessing username', async () => {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 7, username: 'Matching-looking name', role: 'crew', tutorName: 'Untrusted context' }); await next(); });
  app.post('/sso', createSsoHandler({ secret, db: { prepare: () => ({ all: () => [{ id: 1, url: 'https://service.example.test/', required_role: 'crew' }], get: () => ({ tutor_name: null }) }) } }));
  const response = await app.request('/sso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemId: 1, tutorName: 'Forged' }) });
  assert.equal(jwt.verify((await response.json()).token, secret).tutorName, null);
});
