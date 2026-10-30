import { createLoginHandler } from '../src/login.js';
import { initialCredentialSessionAllowed } from '../src/initial-credentials.js';
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
    id: index + 2, username: `target-${role}`, role, created_at: '2026-01-01', tutor_name: '"<script>unsafe</script>',
  }));
  const context = {
    Hono, canManageUser, createUserManagementHandlers, createSsoHandler, createLoginHandler, initialCredentialSessionAllowed,
    serve() {}, serveStatic: () => async (_c, next) => next(),
    bcrypt: {}, jwt: { verify: () => ({ userId: actor.id }) },
    parse: () => ({ auth_token: 'test-only-cookie' }), serialize: () => '',
    JWT_SECRET: 'test-only-placeholder', process: { env: {} },
    console: { log() {}, error() {} },
    db: { prepare(sql) { return {
      get() { return sql.includes('FROM sessions') ? { user_id: actor.id } : actor; },
      all() {
        if (sql.includes('FROM users')) return users;
        if (sql.includes('FROM systems')) return [{
          id: 42,
          name: 'WannaV 延長管理システム',
          url: 'https://extended-management.onrender.com/',
          required_role: 'crew',
        }];
        return [];
      },
    }; } },
  };
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  runInNewContext(`${source}\nglobalThis.testApp = app;`, context);
  return context.testApp;
}

test('dashboard requests SSO for the selected system ID', async () => {
  const response = await renderApp('crew').request('/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("openSystemWithSSO(42, 'https://extended-management.onrender.com/'"));
  assert.ok(html.includes("axios.post('/api/generate-sso-token', {\n                    systemId: systemId"));
  assert.equal(html.includes('targetUrl: targetUrl'), false);
});

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
    assert.equal(html.includes('id="tutor-name-4"'), false);
    assert.equal(html.includes('onclick="syncTutorName(4)"'), false);
    assert.equal(html.includes('aria-label="担任Tutor対応名" readonly'), false);
    assert.equal(html.includes('value=""<script>unsafe'), false);
    assert.ok(html.includes('onclick="changePassword(4,'));
    assert.ok(html.includes('onclick="deleteUser(4,'));
    const creationScript = html.slice(html.indexOf('function showAddUserModal'), html.indexOf('async function changePassword'));
    assert.ok(creationScript.includes('value="crew"'));
    assert.equal(creationScript.includes('value="leader"'), role === 'admin');
    assert.equal(creationScript.includes('value="admin"'), role === 'admin');
  });
}


async function credentialUiFixture() {
 const html=await (await renderApp('admin').request('/admin')).text();
 const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function showInitialCredential'));
 const nodes=new Map();const requests=[];const copies=[];let reloads=0;
 function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',handlers:{},classList:{add(){},remove(){}},addEventListener(event,callback){this.handlers[event]=callback;},replaceChildren(){this.innerHTML='';},focus(){},select(){}});return nodes.get(id);}
 const context={document:{getElementById:node},navigator:{clipboard:{async writeText(value){copies.push(value);}}},location:{reload(){reloads++;}},confirm:()=>true,alert(){throw new Error('unexpected UI error');},FormData:class {get(key){return key==='username'?'<b data-synthetic>synthetic</b>':'crew';}},axios:{async post(url,body){requests.push({url,body});return {data:{initialPassword:'synthetic-only-temporary-credential'}};},async put(url,body){requests.push({url,body});return {data:{initialPassword:'synthetic-only-reissued-credential'}};}}};
 runInNewContext(source,context);return {context,node,requests,copies,get reloads(){return reloads;}};
}
test('real create UI displays issued credential as value once, copies and clears on close',async()=>{
 const f=await credentialUiFixture();f.context.showAddUserModal();await f.node('addUserForm').handlers.submit({preventDefault(){},target:{}});
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/api/admin/users');assert.equal(f.node('initial-password').value==='synthetic-only-temporary-credential',true);
 assert.equal(f.node('initial-user').textContent==='<b data-synthetic>synthetic</b>',true);assert.equal(f.node('modal-content').innerHTML.includes('synthetic-only-temporary-credential'),false);
 await f.node('copy-initial-password').handlers.click();assert.equal(f.copies.length,1);assert.equal(f.copies[0]===f.node('initial-password').value,true);
 f.node('close-initial-password').handlers.click();assert.equal(f.node('initial-password').value,'');assert.equal(f.node('modal-content').innerHTML,'');assert.equal(f.reloads,1);
});
test('real reset UI sends no operator-selected password and uses the same one-time display',async()=>{
 const f=await credentialUiFixture();await f.context.changePassword(2,'synthetic');assert.equal(f.requests[0].url,'/api/admin/users/2/password');assert.equal(Object.keys(f.requests[0].body).length,0);assert.equal(f.node('initial-password').value==='synthetic-only-reissued-credential',true);assert.equal(f.reloads,0);
});
