import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { stateStore } from '../server/state-store.js';
import { CanvaMcp, safeCanvaRequestId } from '../server/integrations/canva-http.js';

test('MCP failures retain a labelled CF-Ray fallback without exposing secrets or overriding native request IDs', async () => {
  assert.equal(safeCanvaRequestId(new Headers({ 'cf-ray': 'synthetic-ray-IAD' })), 'cf-ray:synthetic-ray-IAD');
  assert.equal(safeCanvaRequestId(new Headers({ 'cf-ray': 'synthetic-ray-IAD', 'x-request-id': 'canva-native-request' })), 'canva-native-request');
  assert.equal(safeCanvaRequestId(new Headers({ 'cf-ray': 'private-access-token' }), ['private-access-token']), undefined);
  assert.equal(safeCanvaRequestId(new Headers({ 'cf-ray': 'https://canva.ai/private?token=secret' })), undefined);
  const native = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: 'internal_error', message: 'private-access-token' }, { status: 500, headers: { 'cf-ray': 'synthetic-ray-IAD' } });
    };
    await assert.rejects(new CanvaMcp(async () => 'private-access-token').connect(), (error: any) => {
      assert.equal(error.phase, 'mcp.initialize'); assert.equal(error.upstreamStatus, 500);
      assert.equal(error.requestId, 'cf-ray:synthetic-ray-IAD'); assert.equal(error.outcomeUnknown, false);
      assert.doesNotMatch(error.message, /private-access-token/);
      return true;
    });
    assert.equal(calls, 1, 'a failed initialization must not refresh or replay automatically');
  } finally { globalThis.fetch = native; }
});

test('suspended external-design HTTP routes retain credentials and perform no provider requests', async () => {
  const native=globalThis.fetch;
  const app=await createApp({apiOnly:true});const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let external=0;
  const original=stateStore().get('canvaCredentials','user');
  stateStore().set('canvaCredentials','user',{accessToken:'synthetic-private-token',refreshToken:'synthetic-private-refresh',expiresAt:Date.now()+3600000});
  const retained=stateStore().get('canvaCredentials','user');
  try {
    globalThis.fetch=async(input,init)=>{if(String(input).startsWith(base))return native(input,init);external++;assert.fail('paused routes must not call OAuth, MCP or any provider');};
    const routes:[string,string][]=[['GET','/api/integrations/canva'],['POST','/api/integrations/canva/connect'],['GET','/api/integrations/canva/callback?code=ignored&state=ignored'],['POST','/api/integrations/canva/verify'],['POST','/api/integrations/canva/disconnect'],['POST','/api/deliveries/00000000-0000-4000-8000-000000000001/canva/sync']];
    for(const [method,url] of routes){const r=await fetch(base+url,{method,...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{})});const body=await r.json();assert.equal(r.status,410);assert.equal(body.code,'EXTERNAL_DESIGN_PAUSED');assert.equal(body.retryable,false);assert.equal(body.outcomeUnknown,false);assert.doesNotMatch(JSON.stringify(body),/synthetic-private|token=|Bearer/);}
    const status=await fetch(base+'/api/status').then(r=>r.json());assert.equal(status.canva,undefined);
    for(const request of [{visualMode:'canva'},{canvaSync:true}]){const r=await fetch(base+'/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'render',idempotencyKey:crypto.randomUUID(),request:{runId:'synthetic-run',revision:1,platform:'poster',selectedTitleIndex:0,templateId:'poster-paper',...request}})});assert.equal(r.status,410);assert.equal((await r.json()).code,'EXTERNAL_DESIGN_PAUSED');}
    assert.equal(external,0);assert.deepEqual(stateStore().get('canvaCredentials','user'),retained);
  } finally {globalThis.fetch=native;if(original===undefined)stateStore().remove('canvaCredentials','user');else stateStore().set('canvaCredentials','user',original);server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
