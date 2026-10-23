import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
import { Hono } from 'hono';
import { canManageUser } from '../src/security.js';
import { createUserManagementHandlers } from '../src/user-management.js';
import { createSsoHandler } from '../src/sso.js';

// Exercise the real route/template without loading native SQLite or listening.
function renderApp(role) {
  const actor = { id: 1, username: 'actor', role, must_change_password: 0 };
  const users = ['admin', 'leader', 'crew'].map((role, index) => ({
    id: index + 2, username: `target-${role}`, role, created_at: '2026-01-01',
  }));
  const context = {
    Hono, canManageUser, createUserManagementHandlers, createSsoHandler,
    serve() {}, serveStatic: () => async (_c, next) => next(),
    bcrypt: {}, jwt: { verify: () => ({ userId: actor.id }) },
    parse: () => ({ auth_token: 'test-only-cookie' }), serialize: () => '',
    JWT_SECRET: 'test-only-placeholder', process: { env: {} },
    console: { log() {}, error() {} },
    db: { prepare(sql) { return {
      get() { return sql.includes('FROM sessions') ? { user_id: actor.id } : actor; },
      all() { return sql.includes('FROM users') ? users : []; },
    }; } },
  };
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  runInNewContext(`${source}\nglobalThis.testApp = app;`, context);
  return context.testApp;
}

for (const role of ['admin', 'leader']) {
  test(`${role} admin page renders valid browser JS and appropriate account controls`, async () => {
    const app = renderApp(role);
    const response = await app.request('/admin');
    assert.equal(response.status, 200);
    const html = await response.text();
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).filter(source => source.trim());
    assert.ok(scripts.length > 0);
    for (const source of scripts) assert.doesNotThrow(() => new Script(source));
    assert.equal(html.includes('onclick="changePassword(2,'), role === 'admin');
    assert.equal(html.includes('onclick="changePassword(3,'), role === 'admin');
    assert.equal(html.includes('onclick="deleteUser(2,'), role === 'admin');
    assert.equal(html.includes('onclick="deleteUser(3,'), role === 'admin');
    assert.ok(html.includes('onclick="changePassword(4,'));
    assert.ok(html.includes('onclick="deleteUser(4,'));
    const creationScript = html.slice(html.indexOf('function showAddUserModal'), html.indexOf('async function changePassword'));
    assert.ok(creationScript.includes('value="crew"'));
    assert.equal(creationScript.includes('value="leader"'), role === 'admin');
    assert.equal(creationScript.includes('value="admin"'), role === 'admin');
  });
}
