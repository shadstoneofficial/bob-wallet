const assert=require('node:assert/strict');
const test=require('node:test');
const Module=require('node:module');
const {EventEmitter}=require('node:events');
require('@babel/register')({extensions:['.js'],configFile:false,babelrc:false,presets:[['@babel/preset-env',{targets:{node:'current'}}],'@babel/preset-react'],plugins:[['@babel/plugin-proposal-decorators',{legacy:true}],'@babel/plugin-proposal-class-properties']});
require.extensions['.scss']=()=>{};
const React=require('react');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT=true;
const {act,Simulate}=require('react-dom/test-utils');
const {createRoot}=require('react-dom/client');
const {Provider}=require('react-redux');
const {MemoryRouter}=require('react-router-dom');
const {createStore}=require('redux');
const {installProductRuntime}=require('../../app/background/packagedAcceptance/productRuntime');
const walletReducer=require('../../app/ducks/walletReducer').default;
const {GET_PASSPHRASE}=require('../../app/ducks/walletReducer');
const {disposableWalletService}=require('./fixtures/disposable-wallet-service.cjs');
const {wrapAcceptanceWalletMethods}=require('../../app/background/packagedAcceptance/policy');
const events=new EventEmitter();
// The fixed basket deliberately issues twenty parallel, short-lived RPC calls.
events.setMaxListeners(100);
let rpc;
const ipcRenderer={send(channel,data){Promise.resolve().then(()=>rpc({sender:{send:(channel,value)=>events.emit(channel,{},value)}},data));},on:(channel,fn)=>events.on(channel,fn),off:(channel,fn)=>events.off(channel,fn)};
const context=React.createContext({t:key=>key});
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='electron')return {app:{isPackaged:true,isAcceptance:true},ipcRenderer,
    shell:{openExternal:()=>assert.fail('External navigation is not part of a fixture')}};
  if(request.endsWith('/utils/i18n'))return {I18nContext:context};
  return originalLoad.call(this,request,parent,isMain);
};
const {makeServer}=require('../../app/background/ipc/ipc');
const InteractiveFixture=require('../../app/background/packagedAcceptance/InteractiveFixture').default;
const {FIXED_RESOURCE}=require('../../app/background/packagedAcceptance/InteractiveFixture');
test.after(()=>{Module._load=originalLoad;});
const translations=require('../../locales/en.json');
const t=(key,...args)=>{let text=translations[key]||key;for(const value of args)text=text.replace('%s',value);return text;};

async function startBackend(scenario,values=new Map()){
  const server=makeServer({on:(channel,handler)=>{rpc=handler;},removeListener(){}},()=>true,()=>{});
  const db={get:async key=>values.get(key)||null,put:async(key,value)=>values.set(key,structuredClone(value))};
  installProductRuntime({scenario},db,server);
  const runtime=require('../../app/background/packagedAcceptance/productRuntime').getProductRuntime();
  const service=disposableWalletService();
  await runtime.attachWalletService(service);
  runtime.acceptanceTestService=service;
  server.withService('Wallet',wrapAcceptanceWalletMethods({getAuctionInfo:()=>assert.fail('raw auction'),findBasketBidTransactions:()=>assert.fail('raw history'),prepareBidMany:()=>assert.fail('raw construction'),signPreparedBidMany:()=>assert.fail('raw signing'),cancelBidManyAttempt:()=>assert.fail('raw cancellation'),broadcastPreparedBidMany:()=>assert.fail('live broadcast'),getPendingTransactions:()=>assert.fail('raw pending history'),sendRegisterAll:()=>assert.fail('real registration service'),getRegisterAllStatus:()=>assert.fail('real journal access'),cancelRegisterAll:()=>assert.fail('real cancellation')},true));
  server.withService('DB',db);
  server.withService('Node',runtime.nodeMethods);
  server.withService('Analytics',{screenView:async()=>null});
  server.start();
  return runtime;
}
const tick=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
async function waitFor(predicate,label,timeout=5000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await predicate())return;await tick();}
  assert.fail(`Timed out waiting for ${label}`);
}
async function mount(){
  const root=createRoot(document.getElementById('root'));
  const reducer=(state={wallet:undefined,node:{chain:{height:1000}}},action)=>({
    ...state,wallet:walletReducer(state.wallet,action),
  });
  const store=createStore(reducer);
  root.acceptanceStore=store;
  await act(async()=>root.render(React.createElement(Provider,{store},React.createElement(context.Provider,{value:{t}},React.createElement(MemoryRouter,null,React.createElement(InteractiveFixture))))));
  await tick();return root;
}
async function click(text){
  const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===text);
  assert(button,`Button missing: ${text}`);assert(!button.disabled,`Button disabled: ${text}`);
  await act(async()=>button.click());await tick();
}
async function reviewAndAccept(){
  const review=[...document.querySelectorAll('button')].find(button=>button.textContent.includes(t('basketReview')));
  assert(review,'Review button missing');await act(async()=>review.click());await tick();
  const checkbox=document.querySelector('.auction-basket__confirm input');assert(checkbox);
  await act(async()=>checkbox.click());await tick();
}
async function submit(){
  const button=document.querySelector('.auction-basket__footer-actions button:last-child');assert(button&&!button.disabled);
  await act(async()=>button.click());await tick();
}
function isolateBasketCase(name){
  if(process.env.BOB_BASKET_CASE_CHILD === name)return false;
  const {spawnSync}=require('node:child_process');
  const environment={...process.env,BOB_BASKET_CASE_CHILD:name};
  delete environment.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test',`--test-name-pattern=${name}`,__filename],{
    env:environment,encoding:'utf8',timeout:45000,
  });
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/# pass 1\b/);
  return true;
}

test('real renderer, IPC and fixed backend show pre-signing failure and Retry',async()=>{
  const runtime=await startBackend('auction-retry');const root=await mount();
  try{
    await reviewAndAccept();await submit();
    assert.match(document.body.textContent,/Controlled pre-signing construction failure/);
    const retry=document.querySelector('.auction-basket__footer-actions button:last-child');assert(retry.disabled);assert.equal(retry.textContent.trim(),t('basketRetrySubmission'));
    await act(async()=>document.querySelector('.auction-basket__confirm input').click());await tick();
    await act(async()=>retry.click());await tick();
    assert.equal((await runtime.describe()).state.preparationCalls,2);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('real renderer Back and unmount cancel delayed 20-name construction and preserve rows',async()=>{
  const runtime=await startBackend('basket-20-delayed');const root=await mount();
  try{
    await reviewAndAccept();await submit();
    assert.equal((await runtime.describe()).state.preparationCalls,1);
    const back=document.querySelector('.auction-basket__footer-actions button:first-child');await act(async()=>back.click());await tick();
    assert.equal((await runtime.describe()).state.cancellationCalls,1);
    await reviewAndAccept();await submit();
    await click('Leave basket');
    assert.equal((await runtime.describe()).state.cancellationCalls,2);
    await click('Return to basket');
    assert.equal(document.querySelectorAll('.auction-basket tbody tr').length,20);
    assert.equal((await runtime.describe()).state.inertBoundaryCalls,0);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('real renderer ambiguous result stays locked through navigation and remount',async()=>{
  const runtime=await startBackend('basket-ambiguous');let root=await mount();
  try{
    await reviewAndAccept();await submit();
    assert.match(document.body.textContent,/Review the exact transaction/);
    assert.equal((await runtime.describe()).state.inertBoundaryCalls,0);
    await act(async()=>document.querySelector('.auction-basket__confirm input').click());await tick();
    await submit();
    assert.match(document.body.textContent,/Controlled ambiguous result/);
    assert(document.querySelector('.auction-basket__footer-actions button:last-child').disabled);
    await click('Leave basket');await click('Return to basket');
    await reviewAndAccept();
    assert(document.querySelector('.auction-basket__footer-actions button:last-child').disabled);
    await act(async()=>root.unmount());root=await mount();await reviewAndAccept();
    assert(document.querySelector('.auction-basket__footer-actions button:last-child').disabled);
    assert.equal((await runtime.describe()).state.inertBoundaryCalls,1);
    assert.equal((await runtime.describe()).state.preparationCalls,1);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

for(const [scenario,label] of [['basket-expired','Expire first reviewed name'],['basket-scope-mismatch','Change first reviewed bid']]){
  test(`${scenario} stops the reviewed basket before construction`,async()=>{
    if(isolateBasketCase(`${scenario} stops the reviewed basket before construction`))return;
    const runtime=await startBackend(scenario);const root=await mount();
    try{
      await reviewAndAccept();await click(label);await submit();
      await waitFor(()=>document.body.textContent.includes(scenario==='basket-expired'
        ? 'fixture-01/ is CLOSED' : 'The names, amounts, fee or transaction count changed.'),scenario);
      const value=(await runtime.describe()).state;
      assert.equal(value.controlStep,1);assert.equal(value.preparationCalls,0);
      assert.equal(value.inertBoundaryCalls,0);assert.equal(value.liveBroadcastCalls,0);
      assert.equal(document.querySelectorAll('.auction-basket tbody tr').length,20);
    }finally{await act(async()=>root.unmount());window.localStorage.clear();}
  });
}

test('wallet A-B-A during delayed basket preflight cancels without a late boundary',{timeout:30000},async()=>{
  if(isolateBasketCase('wallet A-B-A during delayed basket preflight'))return;
  const runtime=await startBackend('basket-wallet-switch');const root=await mount();
  try{
    await reviewAndAccept();await submit();
    assert.equal((await runtime.describe()).state.preparationCalls,1);
    await click('Switch fixed fixture wallet');
    await waitFor(async()=>(await runtime.describe()).state.cancellationCalls>=1,'wallet-switch cancellation');
    await click('Switch fixed fixture wallet');
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10200));});
    const value=(await runtime.describe()).state;
    assert.equal(value.selectedWallet,'acceptance-primary');
    assert.equal(value.preparationCalls,1);assert.equal(value.inertBoundaryCalls,0);
    assert.equal(value.backendGuardRejections,0,'component cancellation precedes backend timeout guard');
    assert.equal(value.liveBroadcastCalls,0);
    assert.equal(runtime.acceptanceTestService.name,'acceptance-primary');
    assert.equal(runtime.acceptanceTestService.walletSelectionGeneration,2);
    assert.equal(Number(document.querySelector('[data-testid="acceptance-renderer-generation"]').textContent),3);
    assert.equal(document.querySelectorAll('.auction-basket tbody tr').length,20);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

for(const [scenario,exact] of [['basket-reconcile-exact',true],['basket-reconcile-wrong',false]]){
  test(`${scenario} accepts only the exact history ID after one inert boundary`,async()=>{
    if(isolateBasketCase(`${scenario} accepts only the exact history ID after one inert boundary`))return;
    const runtime=await startBackend(scenario);const root=await mount();
    try{
      await reviewAndAccept();await submit();
      await waitFor(()=>document.body.textContent.includes(t('basketExactReview')),'exact-fee review');
      await act(async()=>document.querySelector('.auction-basket__confirm input').click());await tick();
      await submit();
      await waitFor(async()=>(await runtime.describe()).state.inertBoundaryCalls===1,'inert boundary');
      if(exact){
        await waitFor(()=>document.querySelector('[data-testid="acceptance-basket-clears"]').textContent==='1','exact-ID completion');
      }else{
        await waitFor(()=>document.querySelector('.auction-basket__footer-actions button:last-child').disabled,'wrong-ID retry lock');
        assert.equal(document.querySelector('[data-testid="acceptance-basket-clears"]').textContent,'0');
      }
      const value=(await runtime.describe()).state;
      assert.equal(value.preparationCalls,1);assert.equal(value.inertBoundaryCalls,1);
      assert(value.historyLookupCalls>=2);assert.equal(value.liveBroadcastCalls,0);
    }finally{await act(async()=>root.unmount());window.localStorage.clear();}
  });
}

test('actual ShakeX form reviews changes and removal while preserving unrelated DNS records',async()=>{
  const runtime=await startBackend('multiwallet');const root=await mount();
  try{
    const inputs=document.querySelectorAll('.shakex-listing-form input');
    await act(async()=>{
      Simulate.change(inputs[0],{target:{value:'5'}});
      Simulate.change(inputs[1],{target:{value:'Updated acceptance contact'}});
    });
    await click(t('shakexReviewChanges'));
    let review=JSON.parse(document.querySelector('[data-testid="acceptance-resource-review"]').textContent);
    const unrelated=review.beforeResource.records.slice(0,3);
    assert.deepEqual(review.afterResource.records.slice(0,3),unrelated);
    assert.deepEqual(review.afterResource.records.slice(3),[
      {type:'TXT',txt:['v=FORSALE1;fval=HNS5']},
      {type:'TXT',txt:['v=FORSALE1;ftxt=Updated acceptance contact']},
    ]);
    await click(t('shakexReviewRemoval'));
    review=JSON.parse(document.querySelector('[data-testid="acceptance-resource-review"]').textContent);
    assert.deepEqual(review.afterResource.records,unrelated);
    assert.equal((await runtime.describe()).state.inertBoundaryCalls,0);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('actual ShakeX browsing and search use only the fixed local IPC catalog',async()=>{
  await startBackend('multiwallet');const originalFetch=global.fetch;
  global.fetch=()=>assert.fail('Live ShakeX request');
  const root=await mount();
  try{
    await click(t('shakexLoad'));
    assert.equal(document.querySelectorAll('.shakex-addon article').length,2);
    const search=document.querySelector('.shakex-addon label input');
    await act(async()=>Simulate.change(search,{target:{value:'two'}}));
    assert.equal(document.querySelectorAll('.shakex-addon article').length,1);
    assert.equal(document.querySelector('.shakex-addon article h3').textContent,'fixture-sale-two/');
  }finally{await act(async()=>root.unmount());global.fetch=originalFetch;window.localStorage.clear();}
});

test('actual disposable login verification does not request or reveal a seed',async()=>{
  const {verifyPhrase}=require('../../app/ducks/walletActions');
  const {SET_PHRASE_MISMATCH}=require('../../app/ducks/walletReducer');
  const actions=[];
  await verifyPhrase('unused-disposable-test-passphrase')(action=>actions.push(action),()=>({wallet:{watchOnly:false}}));
  assert.deepEqual(actions,[{type:SET_PHRASE_MISMATCH,payload:false}]);
});

test('real delayed 20-name success clears only after one inert result with an ID',async()=>{
  // A different disposable app process must not share the earlier ambiguity lock.
  if(process.env.BOB_INERT_SUCCESS_CHILD !== 'true') {
    const {spawnSync}=require('node:child_process');
    const environment={...process.env,BOB_INERT_SUCCESS_CHILD:'true'};
    delete environment.NODE_TEST_CONTEXT;
    const result=spawnSync(process.execPath,['--test','--test-name-pattern=real delayed 20-name success',__filename],{
      env:environment,encoding:'utf8',timeout:30000,
    });
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/# pass 1\b/);
    return;
  }
  const runtime=await startBackend('basket-20-delayed');const root=await mount();
  try{
    await reviewAndAccept();await submit();
    assert.equal(document.querySelector('[data-testid="acceptance-basket-clears"]').textContent,'0');
    for(let i=0;i<120 && !document.body.textContent.includes(t('basketExactReview'));i++){
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,100));});
    }
    assert(document.body.textContent.includes(t('basketExactReview')));
    assert.equal((await runtime.describe()).state.inertBoundaryCalls,0,'new fee review cannot auto-send');
    assert.equal(document.querySelector('[data-testid="acceptance-basket-clears"]').textContent,'0');
    await act(async()=>document.querySelector('.auction-basket__confirm input').click());await tick();
    await submit();
    await tick();
    const state=(await runtime.describe()).state;
    assert.equal(state.preparationCalls,1);
    assert.equal(state.inertBoundaryCalls,1);
    assert.equal(state.liveBroadcastCalls,0);
    assert.match(state.inertTxid,/^[a-f0-9]{64}$/);
    assert.equal(document.querySelector('[data-testid="acceptance-basket-clears"]').textContent,'1');
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('actual Register All renderer and journal retain six receipts across restart then resume exactly32',async()=>{
  const values=new Map();let runtime=await startBackend('register-partial',values);let root=await mount();
  try{
    await click(t('registerAll'));
    assert.match(document.body.textContent,/6 of 38 registrations submitted/);
    assert.match(document.body.textContent,/Controlled seventh-registration preparation failure/);
    assert.equal(document.querySelectorAll('.register-all code').length,6);
    let evidence=(await runtime.describe()).registration;
    assert.equal(evidence.inertBoundaryCalls,6);
    await act(async()=>root.unmount());
    runtime=await startBackend('register-partial',values);root=await mount();
    assert.equal(document.querySelectorAll('.register-all code').length,6);
    await click(t('registrationResume'));
    assert.match(document.body.textContent,/38 of 38 registrations submitted/);
    assert.equal(document.querySelectorAll('.register-all code').length,38);
    evidence=(await runtime.describe()).registration;
    assert.equal(evidence.constructionCalls,39);
    assert.equal(evidence.inertBoundaryCalls,38);
    assert.equal(new Set(evidence.acceptedNames).size,38);
    assert.equal(evidence.liveBroadcastCalls,0);
    assert.equal(evidence.signatureCalls,0);
    assert.equal(evidence.walletServiceProxy,'MOCKED');
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('actual Register All renderer remains retry locked after ambiguous outcome and backend reopen',async()=>{
  const values=new Map();let runtime=await startBackend('register-ambiguous',values);let root=await mount();
  try{
    await click(t('registerAll'));
    assert.match(document.body.textContent,/Broadcast status is uncertain/);
    assert(document.querySelector('.register-all button').disabled);
    const txid=document.querySelector('.register-all code').textContent;
    await act(async()=>root.unmount());
    runtime=await startBackend('register-ambiguous',values);root=await mount();
    assert(document.querySelector('.register-all button').disabled);
    assert.equal(document.querySelector('.register-all code').textContent,txid);
    await runtime.walletMethods.sendRegisterAll(undefined,{walletId:'acceptance-primary',network:'regtest',operationId:'duplicate'});
    assert.equal((await runtime.describe()).registration.constructionCalls,1);
    assert.equal((await runtime.describe()).registration.inertBoundaryCalls,1);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('actual Register All Stop and navigation cancel inert delayed work with no later boundary',async()=>{
  const runtime=await startBackend('register-cancel');const root=await mount();
  try{
    await click(t('registerAll'));
    assert.equal((await runtime.describe()).registration.constructionCalls,1);
    await click(t('registrationStop'));
    assert.match(document.body.textContent,/No further registrations will be sent/);
    await click(t('registrationResume'));
    await click('Leave registrations');
    await click('Return to registrations');
    assert.equal((await runtime.describe()).registration.inertBoundaryCalls,0);
    assert.equal((await runtime.describe()).registration.constructionCalls,2);
    assert.equal(document.querySelectorAll('.register-all tbody tr').length,38);
    assert.equal(document.querySelectorAll('.register-all code').length,0);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

for(const [scenario,exact] of [['register-reconcile-exact',true],['register-reconcile-wrong',false]]){
  test(`${scenario} changes only the exact candidate-ID journal result`,{timeout:20000},async()=>{
    const values=new Map();let runtime=await startBackend(scenario,values);let root=await mount();
    try{
      await click(t('registerAll'));
      await waitFor(async()=>(await runtime.describe()).registration.inertBoundaryCalls===1,'registration inert boundary');
      assert(document.querySelector('.register-all button').disabled);
      await click(exact?'Offer exact candidate ID':'Offer wrong candidate ID');
      const candidate=exact ? document.querySelector('.register-all code').textContent : 'bd'.repeat(32);
      await waitFor(async()=>(await runtime.describe()).registration.historyCandidateTxid===candidate,
        'post-transition registration candidate lookup',7000);
      await waitFor(()=>exact
        ? document.querySelector('.register-all button').textContent===t('registrationResume')
          && !document.querySelector('.register-all button').disabled
        : document.querySelector('.register-all button').disabled,'registration reconciliation',7000);
      const registration=(await runtime.describe()).registration;
      assert.equal(registration.constructionCalls,1);
      assert.equal(registration.inertBoundaryCalls,1);
      assert.equal(registration.liveBroadcastCalls,0);
      assert.equal(registration.signatureCalls,0);
      assert.equal(registration.historyCandidateTxid,candidate);
      assert.equal(registration.statusEndpoint,'real-WalletService.getRegisterAllStatus');
      assert.equal(document.querySelectorAll('.register-all code').length,1);
      await act(async()=>root.unmount());
      runtime=await startBackend(scenario,values);root=await mount();
      await waitFor(()=>!!document.querySelector('.register-all button'),'reopened registration');
      if(exact){
        assert(!document.querySelector('.register-all button').disabled);
        await click(t('registrationResume'));
        await waitFor(()=>document.body.textContent.includes('38 of 38 registrations submitted'),
          'remaining registrations');
        const reopened=(await runtime.describe()).registration;
        assert.equal(reopened.constructionCalls,38);
        assert.equal(reopened.inertBoundaryCalls,38);
        assert.equal(new Set(reopened.acceptedNames).size,38);
      }else{
        assert(document.querySelector('.register-all button').disabled);
        assert.equal((await runtime.describe()).registration.constructionCalls,1);
      }
    }finally{await act(async()=>root.unmount());window.localStorage.clear();}
  });
}

test('active Register All A-B-A cancels delayed work without stale receipts',{timeout:30000},async()=>{
  const runtime=await startBackend('register-wallet-switch');const root=await mount();
  try{
    await click(t('registerAll'));
    await waitFor(async()=>(await runtime.describe()).registration.constructionCalls===1,'registration construction');
    await click('Switch fixed fixture wallet');
    await waitFor(async()=>(await runtime.describe()).state.selectedWallet==='acceptance-secondary','secondary wallet');
    await click('Switch fixed fixture wallet');
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10200));});
    const result=await runtime.describe();
    assert.equal(result.walletId,'acceptance-primary');
    assert.equal(result.registration.constructionCalls,1);
    assert.equal(result.registration.inertBoundaryCalls,0);
    assert.equal(result.registration.liveBroadcastCalls,0);
    assert.equal(runtime.acceptanceTestService.walletSelectionGeneration,2);
    assert.equal(Number(document.querySelector('[data-testid="acceptance-renderer-generation"]').textContent),3);
    assert.equal(document.querySelectorAll('.register-all code').length,0);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('Register All thunk rejects stale A-B-A generation before backend submission',async()=>{
  const runtime=await startBackend('register-wallet-switch');const root=await mount();
  try{
    const store=root.acceptanceStore;
    const getState=()=>store.getState();
    let releasePassphrase;
    const dispatch=action=>{
      if(typeof action==='function')return action(dispatch,getState);
      if(action?.type===GET_PASSPHRASE){releasePassphrase=action.payload.resolve;return;}
      return store.dispatch(action);
    };
    const {sendRegisterAll}=require('../../app/ducks/names');
    const pending=sendRegisterAll(()=>true,'fixed-stale-generation')(dispatch,getState);
    await waitFor(()=>typeof releasePassphrase==='function','held passphrase request');
    await click('Switch fixed fixture wallet');await click('Switch fixed fixture wallet');
    assert.equal(getState().wallet.wid,'acceptance-primary');
    assert.equal(getState().wallet.requestGeneration,3);
    releasePassphrase();
    await assert.rejects(pending,/cancelled before submission/);
    assert.equal((await runtime.describe()).registration.constructionCalls,0);
    assert.equal((await runtime.describe()).registration.inertBoundaryCalls,0);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('actual owned-name Records chooser keeps Shakedex and ShakeX separate without a write',async()=>{
  await startBackend('owned-name-sell');const originalFetch=global.fetch;
  global.fetch=()=>assert.fail('No marketplace HTTP in owned-name chooser fixture');
  const root=await mount();
  try{
    assert.equal(document.querySelectorAll('.name-selling__options button').length,2);
    await click(t('sellNameShakedexAction'));
    const route=JSON.parse(document.querySelector('[data-testid="acceptance-sell-state"]').textContent);
    assert.equal(route.saleRoute,'/exchange?createListing=1&name=fixture-owned');
    assert.equal(route.blockedWrites,0);
    await click(t('sellNameShakexAction'));
    assert(document.querySelector('.name-selling .shakex-listing-form'));
    assert.equal(JSON.parse(document.querySelector('[data-testid="acceptance-sell-state"]').textContent).blockedWrites,0);
  }finally{await act(async()=>root.unmount());global.fetch=originalFetch;window.localStorage.clear();}
});

test('registration fixture refuses non-fixed contexts and protects durable records from renderer writes',async()=>{
  const runtime=await startBackend('register-partial');
  const context={walletId:'acceptance-primary',network:'regtest',operationId:'fixture'};
  await assert.rejects(runtime.walletMethods.sendRegisterAll(undefined,{...context,network:'main'}),/non-fixture context/);
  await assert.rejects(runtime.walletMethods.sendRegisterAll(undefined,{...context,walletId:'other'}),/non-fixture context/);
  await assert.rejects(runtime.walletMethods.sendRegisterAll('unexpected-input',context),/does not accept credentials/);
  const {wrapAcceptanceDbMethods}=require('../../app/background/packagedAcceptance/policy');
  const wrapped=wrapAcceptanceDbMethods({put:()=>assert.fail('renderer write'),del:()=>assert.fail('renderer delete')},true);
  for(const text of ['acceptance-register-state-v1','acceptance-register-journal:register-all:fixture','network']){
    for(const key of [text,Array.from(Buffer.from(text)),new Uint8Array(Buffer.from(text)),Buffer.from(text)]){
    await assert.rejects(wrapped.put(key,{}),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    await assert.rejects(wrapped.del(key),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    }
  }
  await startBackend('multiwallet');
  const nonFixture=wrapAcceptanceWalletMethods({sendRegisterAll:()=>assert.fail('real service'),getRegisterAllStatus:()=>assert.fail('real read'),cancelRegisterAll:()=>assert.fail('real cancellation')},true);
  for(const name of Object.keys(nonFixture))await assert.rejects(nonFixture[name](undefined,context),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.equal((await runtime.describe()).registration.constructionCalls,0);
});

test('Register All uncertainty survives a real disposable database and process restart',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {spawnSync}=require('node:child_process');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bob-register-runtime-'));
  const results=[];
  try{
    for(const phase of ['first','reopen']){
      const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures/register-runtime-restart.cjs'),directory,phase],{encoding:'utf8',timeout:10000});
      assert.equal(child.status,0,child.stdout+child.stderr);
      results.push(JSON.parse(child.stdout.trim()));
    }
    assert.equal(results[0].txid,results[1].txid);
    assert.equal(results[1].constructionCalls,1);
    assert.equal(results[1].inertBoundaryCalls,1);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
