const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {createProductRuntime} = require('../../app/background/packagedAcceptance/productRuntime');
const {buildControlledScenarioPlan} = require('../../app/background/packagedAcceptance/scenarios');
const {wrapAcceptanceDbMethods, wrapAcceptanceWalletMethods, BLOCKED_WALLET_METHODS} = require('../../app/background/packagedAcceptance/policy');
const {disposableWalletService} = require('./fixtures/disposable-wallet-service.cjs');

function memoryDb() {
  const values=new Map();
  return {get:async key=>values.get(key)||null,put:async(key,value)=>values.set(key,structuredClone(value)),del:async key=>values.delete(key)};
}
const payload = scenario => {
  const plan=buildControlledScenarioPlan(scenario);
  return (plan.names||[plan.name]).map(name=>({name,bid:1000000,lockup:2000000}));
};
const attempt='basket-123-abc';

test('runtime pre-signing failure retains error and permits exactly one Retry construction',async()=>{
  const runtime=createProductRuntime({scenario:'auction-retry'},memoryDb());
  for(let i=0;i<2;i++)await assert.rejects(runtime.walletMethods.prepareBidMany(payload('auction-retry'),attempt),{code:'BASKET_BUILD_FAILED'});
  const result=await runtime.describe();
  assert.equal(result.state.preparationCalls,2);
  assert.equal(result.state.inertBoundaryCalls,0);
  assert.equal(result.state.liveBroadcastCalls,0);
});

test('runtime delayed construction cancels without reaching any signing/broadcast method',async()=>{
  const runtime=createProductRuntime({scenario:'basket-20-delayed'},memoryDb());
  const pending=runtime.walletMethods.prepareBidMany(payload('basket-20-delayed'),attempt);
  const rejected=assert.rejects(pending,{code:'BASKET_SUBMISSION_CANCELLED'});
  await new Promise(resolve=>setImmediate(resolve));
  await runtime.walletMethods.cancelBidManyAttempt(attempt);
  await rejected;
  const result=await runtime.describe();
  assert.equal(result.plan.names.length,20);
  assert.equal(result.state.preparationCalls,1);
  assert.equal(result.state.cancellationCalls,1);
  assert.equal(result.state.inertBoundaryCalls,0);
});

test('runtime ambiguous lock survives new adapter with the same disposable database',async()=>{
  const db=memoryDb();
  const first=createProductRuntime({scenario:'basket-ambiguous'},db);
  const quote=await first.walletMethods.prepareBidMany(payload('basket-ambiguous'),attempt);
  await first.walletMethods.signPreparedBidMany(attempt,quote.scope);
  await assert.rejects(first.walletMethods.broadcastPreparedBidMany(attempt),{code:'ETXBROADCASTUNCERTAIN'});
  const second=createProductRuntime({scenario:'basket-ambiguous'},db);
  await assert.rejects(second.walletMethods.prepareBidMany(payload('basket-ambiguous'),attempt),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  const result=await second.describe();
  assert.equal(result.state.uncertain,true);
  assert.equal(result.state.inertBoundaryCalls,1);
  assert.equal(result.state.preparationCalls,1);
  assert.equal(result.state.liveBroadcastCalls,0);
});

test('runtime refuses altered names, amounts and attempts and preserves every raw-wallet deny',async()=>{
  const runtime=createProductRuntime({scenario:'basket-ambiguous'},memoryDb());
  for(const changed of [[],payload('basket-ambiguous').slice(0,1),payload('basket-ambiguous').map(row=>({...row,name:'arbitrary'})),payload('basket-ambiguous').map(row=>({...row,bid:1}))]){
    await assert.rejects(runtime.walletMethods.prepareBidMany(changed,attempt),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  }
  await assert.rejects(runtime.walletMethods.prepareBidMany(payload('basket-ambiguous'),'arbitrary'),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(runtime.walletMethods.broadcastPreparedBidMany(attempt),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  for(const bid of ['1e6','01000000',1000000n,{},null]) {
    await assert.rejects(runtime.walletMethods.prepareBidMany(payload('basket-ambiguous').map(row=>({...row,bid})),attempt),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  }
  const guarded=wrapAcceptanceWalletMethods(Object.fromEntries([...BLOCKED_WALLET_METHODS].map(name=>[name,()=>{throw new Error('raw method reached');}])),true);
  for(const name of BLOCKED_WALLET_METHODS)await assert.rejects(guarded[name](),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  const db=wrapAcceptanceDbMethods(memoryDb(),true);
  await assert.rejects(db.put('acceptance-fixed-product-state-v1',{}),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(db.del('acceptance-fixed-product-state-v1'),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
});

test('runtime accepts only exact numeric or base-unit string fixture amounts',async()=>{
  for(const strings of [false,true]) {
    const runtime=createProductRuntime({scenario:'basket-ambiguous'},memoryDb());
    const rows=payload('basket-ambiguous').map(row=>({...row,
      bid:strings?String(row.bid):row.bid,lockup:strings?String(row.lockup):row.lockup}));
    const quote=await runtime.walletMethods.prepareBidMany(rows,attempt);
    await assert.rejects(runtime.walletMethods.broadcastPreparedBidMany(attempt),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    await assert.rejects(runtime.walletMethods.signPreparedBidMany(attempt,{...quote.scope,fee:0}),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    await runtime.walletMethods.signPreparedBidMany(attempt,quote.scope);
    await assert.rejects(runtime.walletMethods.broadcastPreparedBidMany('basket-456-def'),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    await assert.rejects(runtime.walletMethods.broadcastPreparedBidMany(attempt),{code:'ETXBROADCASTUNCERTAIN'});
  }
});

test('fixed fixture transitions reject arguments, repetition, and unsupported scenarios',async()=>{
  const expired=createProductRuntime({scenario:'basket-expired'},memoryDb());
  await assert.rejects(expired.advance('CLOSED'),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.equal((await expired.nodeMethods.getNameInfo('fixture-01')).info.state,'BIDDING');
  assert.deepEqual(await expired.advance(),{controlStep:1,selectedWallet:'acceptance-primary'});
  assert.equal((await expired.nodeMethods.getNameInfo('fixture-01')).info.state,'CLOSED');
  assert.equal((await expired.nodeMethods.getNameInfo('fixture-02')).info.state,'BIDDING');
  await assert.rejects(expired.advance(),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  const ordinary=createProductRuntime({scenario:'multiwallet'},memoryDb());
  await assert.rejects(ordinary.advance(),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  const switchingDb=memoryDb();
  const switching=createProductRuntime({scenario:'basket-wallet-switch'},switchingDb);
  const service=disposableWalletService();
  await switching.attachWalletService(service);
  assert.equal((await switching.advance()).selectedWallet,'acceptance-secondary');
  const reopened=createProductRuntime({scenario:'basket-wallet-switch'},switchingDb);
  const reopenedService=disposableWalletService();
  await reopened.attachWalletService(reopenedService);
  assert.equal(reopenedService.name,'acceptance-secondary');
  assert.equal((await switching.advance()).selectedWallet,'acceptance-primary');
  assert.equal(service.walletSelectionGeneration,2);
  await assert.rejects(switching.advance(),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
});

test('actual WalletService stale-selection guard rejects delayed A-B-A without component cancellation', {timeout: 20000}, async()=>{
  const runtime=createProductRuntime({scenario:'basket-wallet-switch'},memoryDb());
  const service=disposableWalletService();
  await runtime.attachWalletService(service);
  const pending=runtime.walletMethods.prepareBidMany(payload('basket-wallet-switch'),attempt);
  const rejected=assert.rejects(pending,{code:'BASKET_SCOPE_CHANGED'});
  await new Promise(resolve=>setImmediate(resolve));
  await runtime.advance();await runtime.advance();
  await rejected;
  const result=await runtime.describe();
  assert.equal(service.name,'acceptance-primary');
  assert.equal(service.walletSelectionGeneration,2);
  assert.equal(result.state.backendGuardRejections,1);
  assert.equal(result.state.preparationCalls,1);
  assert.equal(result.state.inertBoundaryCalls,0);
  assert.equal(result.state.liveBroadcastCalls,0);
});

test('basket reconciliation requires the exact candidate ID and cannot construct twice',async()=>{
  for(const [scenario,expected] of [['basket-reconcile-exact','ac'.repeat(32)],['basket-reconcile-wrong','bd'.repeat(32)]]){
    const db=memoryDb();
    const runtime=createProductRuntime({scenario},db);
    assert.deepEqual(await runtime.walletMethods.findBasketBidTransactions(buildControlledScenarioPlan(scenario).names),[]);
    const quote=await runtime.walletMethods.prepareBidMany(payload(scenario),attempt);
    await runtime.walletMethods.signPreparedBidMany(attempt,quote.scope);
    await assert.rejects(runtime.walletMethods.broadcastPreparedBidMany(attempt),{code:'ETXBROADCASTUNCERTAIN'});
    const matches=await runtime.walletMethods.findBasketBidTransactions(buildControlledScenarioPlan(scenario).names);
    assert.deepEqual(matches,[{txid:expected}]);
    assert.equal(matches[0].txid==='ac'.repeat(32),scenario==='basket-reconcile-exact');
    const reopened=createProductRuntime({scenario},db);
    await assert.rejects(reopened.walletMethods.prepareBidMany(payload(scenario),attempt),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    const result=await reopened.describe();
    assert.equal(result.state.preparationCalls,1);
    assert.equal(result.state.inertBoundaryCalls,1);
    assert.equal(result.state.liveBroadcastCalls,0);
  }
});

test('registration reconciliation resolves only the exact recorded candidate ID',async()=>{
  for(const [scenario,unlocked] of [['register-reconcile-exact',true],['register-reconcile-wrong',false]]){
    const db=memoryDb();
    const runtime=createProductRuntime({scenario},db);
    await runtime.attachWalletService(disposableWalletService());
    const context={walletId:'acceptance-primary',network:'regtest',operationId:'fixture-op'};
    const first=await runtime.walletMethods.sendRegisterAll(undefined,context);
    assert.equal(first.retryLocked,true);
    assert.equal(first.entries[0].status,'unknown');
    const missing=await runtime.walletMethods.getRegisterAllStatus(context);
    assert.equal(missing.retryLocked,true);
    assert.equal((await runtime.describe()).registration.historyCandidateTxid,null);
    await runtime.advance();
    const after=await runtime.walletMethods.getRegisterAllStatus(context);
    assert.equal(after.retryLocked,!unlocked);
    assert.equal(after.entries[0].status,unlocked?'submitted':'unknown');
    const reopened=createProductRuntime({scenario},db);
    await reopened.attachWalletService(disposableWalletService());
    const persisted=await reopened.walletMethods.getRegisterAllStatus(context);
    assert.equal(persisted.retryLocked,!unlocked);
    assert.equal(persisted.entries[0].status,unlocked?'submitted':'unknown');
    const resumed=await reopened.walletMethods.sendRegisterAll(undefined,{...context,operationId:'resume'});
    if(unlocked){
      assert.equal(resumed.status,'complete');
      assert.equal(resumed.entries.filter(entry=>entry.status==='submitted').length,38);
      assert.equal((await reopened.describe()).registration.constructionCalls,38);
    }else{
      assert.equal(resumed.retryLocked,true);
      assert.equal((await reopened.describe()).registration.constructionCalls,1);
    }
    const evidence=(await reopened.describe()).registration;
    assert.equal(evidence.inertBoundaryCalls,unlocked?38:1);
    assert.equal(evidence.liveBroadcastCalls,0);
    assert.equal(evidence.signatureCalls,0);
    assert.equal(evidence.statusEndpoint,'real-WalletService.getRegisterAllStatus');
  }
});

test('real disposable bdb journal retains lock through two separate source Node processes',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bob-source-runtime-restart-'));
  try{
    for(const phase of ['first','reuse']){
      const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures/product-runtime-restart.cjs'),root,phase],{encoding:'utf8',env:{...process.env,NODE_BACKEND:'js'}});
      assert.equal(child.status,0,child.stderr);
      const result=JSON.parse(child.stdout);
      assert.equal(result.inertBoundaryCalls,1);
      assert.equal(result.liveBroadcastCalls,0);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
