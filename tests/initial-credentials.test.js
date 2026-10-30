import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createInitialPassword, requiresInitialCredentialReissue, initialCredentialSessionAllowed } from '../src/initial-credentials.js';
import { createUserManagementHandlers } from '../src/user-management.js';
import { createLoginHandler } from '../src/login.js';
import { ensureBootstrapAdmin } from '../src/bootstrap-admin.js';

const secret = 'synthetic-only-secret-for-local-token-tests';
const jsonHeaders = { 'Content-Type': 'application/json' };
function managementFixture(actorRole, targetRole = 'crew') {
 const writes = []; const hashes = [];
 const db = { prepare(sql) { return {
  get() { return sql.includes('SELECT id FROM users WHERE username') ? undefined : {id:2,role:targetRole}; },
  run(...args) { writes.push({sql,args}); return {lastInsertRowid:3}; }
 }; } };
 const crypto = {hashSync(value,rounds){ const hash=bcrypt.hashSync(value,rounds);hashes.push({value,hash});return hash; }};
 const h = createUserManagementHandlers({db,bcrypt:crypto}); const app=new Hono();
 app.use('*',async(c,next)=>{c.set('user',{role:actorRole});await next();});
 app.post('/users',h.create);app.put('/users/:id/password',h.password);
 return {app,writes,hashes};
}
for (const actor of ['admin','leader']) test(`${actor} gets unique hashed temporary credentials with forced change and no-store`,async()=>{
 const f=managementFixture(actor);const body=JSON.stringify({username:'synthetic-user',role:'crew'});
 const a=await f.app.request('/users',{method:'POST',headers:jsonHeaders,body});const b=await f.app.request('/users',{method:'POST',headers:jsonHeaders,body});
 assert.equal(a.status,200);assert.equal(a.headers.get('cache-control'),'no-store');const first=await a.json();const second=await b.json();
 assert.equal(typeof first.initialPassword,'string');assert.equal(first.initialPassword.length,32);assert.equal(first.initialPassword===second.initialPassword,false);
 assert.equal(f.writes[0].args[1]===first.initialPassword,false);assert.equal(bcrypt.compareSync(first.initialPassword,f.writes[0].args[1]),true);assert.equal(f.writes[0].args[3],1);
});
test('all newly created roles including named admin require first change',async()=>{
 const f=managementFixture('admin');const r=await f.app.request('/users',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'admin',role:'admin'})});assert.equal(r.status,200);assert.equal(f.writes[0].args[3],1);
});
for (const actor of ['crew','unknown']) test(`${actor} cannot issue temporary credentials`,async()=>{
 const f=managementFixture(actor);const r=await f.app.request('/users',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'synthetic',role:'crew'})});assert.equal(r.status,403);assert.equal(f.hashes.length,0);assert.equal(f.writes.length,0);
});
test('reset ignores submitted shared password and issues unique temporary credential; sessions invalidated',async()=>{
 const f=managementFixture('admin');const r=await f.app.request('/users/2/password',{method:'PUT',headers:jsonHeaders,body:JSON.stringify({password:'synthetic-short'})});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const b=await r.json();assert.equal(b.initialPassword.length,32);assert.equal(b.initialPassword==='synthetic-short',false);assert.equal(f.writes.some(w=>w.sql.includes('must_change_password = 1')),true);assert.equal(f.writes.some(w=>w.sql.includes('DELETE FROM sessions')),true);
});
function loginFixture(user,password){
 const writes=[];const db={prepare(sql){return {get(){return user;},run(...args){writes.push({sql,args});}};}};
 const app=new Hono();app.post('/login',createLoginHandler({db,bcrypt:{compareSync(input){return input===password;}},jwt,secret}));return {app,writes};
}
test('legacy pending short password refuses before session/JWT even with body marker',async()=>{
 const value='weak';
 assert.equal(value.length<16,true);const f=loginFixture({id:1,username:'synthetic',must_change_password:1,password:'synthetic-hash'},value);
 const r=await f.app.request('/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'synthetic',password:value,initialCredential:true})});assert.equal(r.status,401);assert.equal(f.writes.length,0);assert.equal(r.headers.has('set-cookie'),false);
});
test('new temporary login marker comes from server state, not submitted claims',async()=>{
 const password=createInitialPassword();const f=loginFixture({id:2,username:'synthetic',must_change_password:1,password:'synthetic-hash'},password);const r=await f.app.request('/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'synthetic',password,initialCredential:false,role:'admin',userId:999})});assert.equal(r.status,200);const claims=jwt.verify(f.writes[0].args[1],secret);assert.equal(claims.initialCredential,true);assert.equal(claims.userId,2);assert.equal(claims.role,undefined);
});
test('established short-password account keeps normal login; body marker cannot add initial flag',async()=>{
 const password='synthetic-short';const f=loginFixture({id:3,username:'synthetic',must_change_password:0,password:'synthetic-hash'},password);const r=await f.app.request('/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'synthetic',password,initialCredential:true})});assert.equal(r.status,200);const claims=jwt.verify(f.writes[0].args[1],secret);assert.equal(claims.initialCredential,undefined);
});
test('wrong password cannot create session even with forged body marker',async()=>{
 const f=loginFixture({id:2,username:'synthetic',must_change_password:1,password:'synthetic-hash'},'synthetic-correct');const r=await f.app.request('/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'synthetic',password:'synthetic-wrong',initialCredential:true})});assert.equal(r.status,401);assert.equal(f.writes.length,0);
});
test('real middleware blocks pre-change legacy session and keeps temporary-change/established access',async()=>{
 const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');const code=src.slice(src.indexOf('const authMiddleware ='),src.indexOf('// リーダー以上チェック'));
 async function request(pending,marker,path){
  const user={id:2,username:'synthetic',role:'crew',must_change_password:pending};const context={jwt:{verify(){return {userId:2,...(marker?{initialCredential:true}:{})};}},JWT_SECRET:secret,parse(){return {auth_token:'synthetic-cookie'};},db:{prepare(sql){return {get(){return sql.includes('FROM sessions')?{user_id:2}:user;}};}},console:{log(){},error(){}},initialCredentialSessionAllowed};
  runInNewContext(code+';globalThis.guard=authMiddleware;',context);const app=new Hono();app.get(path,context.guard,c=>c.json({success:true}));return app.request(path);
 }
 assert.equal((await request(1,false,'/change-password')).headers.get('location'),'/login');
 assert.equal((await request(1,true,'/change-password')).status,200);
 assert.equal((await request(1,true,'/')).headers.get('location'),'/change-password');
 assert.equal((await request(0,false,'/')).status,200);
});
function bootstrapFixture(existing){const writes=[];let hashes=0;const db={prepare(sql){return {get(){return existing;},run(...args){writes.push({sql,args});}};}};const crypto={hashSync(value){hashes++;return 'synthetic-hash';}};return {db,bcrypt:crypto,writes,get hashes(){return hashes;}};}
test('bootstrap requires strong explicit secret only for absent admin',()=>{
 for(const value of [undefined,'','short',' '.repeat(40),'x'.repeat(73),'x'.repeat(32)]){const f=bootstrapFixture();assert.throws(()=>ensureBootstrapAdmin({...f,env:{BOOTSTRAP_ADMIN_PASSWORD:value}}),/BOOTSTRAP_ADMIN_PASSWORD/);assert.equal(f.writes.length,0);assert.equal(f.hashes,0);}
 const f=bootstrapFixture();assert.equal(ensureBootstrapAdmin({...f,env:{BOOTSTRAP_ADMIN_PASSWORD:'synthetic-bootstrap-credential-32-characters'}}),true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].args[3],1);
});
test('existing legitimate admin is untouched and needs no bootstrap environment',()=>{
 const f=bootstrapFixture({id:1,role:'admin'});assert.equal(ensureBootstrapAdmin({...f,env:{}}),false);assert.equal(f.writes.length,0);assert.equal(f.hashes,0);
});
test('bootstrap username collision never promotes a low role',()=>{
 for(const role of ['crew','leader']){const f=bootstrapFixture({id:1,role});assert.throws(()=>ensureBootstrapAdmin({...f,env:{BOOTSTRAP_ADMIN_PASSWORD:'synthetic-bootstrap-credential-32-characters'}}),/non-admin/);assert.equal(f.writes.length,0);assert.equal(f.hashes,0);}
});
