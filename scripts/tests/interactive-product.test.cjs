const assert=require('node:assert/strict');
const test=require('node:test');
const Module=require('node:module');
const {EventEmitter}=require('node:events');
require('@babel/register')({extensions:['.js'],configFile:false,babelrc:false,presets:[['@babel/preset-env',{targets:{node:'current'}}],'@babel/preset-react'],plugins:['@babel/plugin-proposal-class-properties']});
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

function startBackend(scenario,values=new Map()){
  const server=makeServer({on:(channel,handler)=>{rpc=handler;},removeListener(){}},()=>true,()=>{});
  const db={get:async key=>values.get(key)||null,put:async(key,value)=>values.set(key,structuredClone(value))};
  installProductRuntime({scenario},db,server);
  const runtime=require('../../app/background/packagedAcceptance/productRuntime').getProductRuntime();
  server.withService('Wallet',wrapAcceptanceWalletMethods({getAuctionInfo:()=>assert.fail('raw auction'),findBasketBidTransactions:()=>assert.fail('raw history'),prepareBidMany:()=>assert.fail('raw construction'),signPreparedBidMany:()=>assert.fail('raw signing'),cancelBidManyAttempt:()=>assert.fail('raw cancellation'),broadcastPreparedBidMany:()=>assert.fail('live broadcast'),getPendingTransactions:()=>assert.fail('raw pending history'),sendRegisterAll:()=>assert.fail('real registration service'),getRegisterAllStatus:()=>assert.fail('real journal access'),cancelRegisterAll:()=>assert.fail('real cancellation')},true));
  server.withService('DB',db);
  server.withService('Node',runtime.nodeMethods);
  server.withService('Analytics',{screenView:async()=>null});
  server.start();
  return runtime;
}
const tick=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
async function mount(){
  const root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Provider,{store:createStore((state={wallet:{}},action)=>state)},React.createElement(context.Provider,{value:{t}},React.createElement(MemoryRouter,null,React.createElement(InteractiveFixture))))));
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

test('real renderer, IPC and fixed backend show pre-signing failure and Retry',async()=>{
  const runtime=startBackend('auction-retry');const root=await mount();
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
  const runtime=startBackend('basket-20-delayed');const root=await mount();
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
  const runtime=startBackend('basket-ambiguous');let root=await mount();
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

test('actual ShakeX form reviews changes and removal while preserving unrelated DNS records',async()=>{
  const runtime=startBackend('multiwallet');const root=await mount();
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
  startBackend('multiwallet');const originalFetch=global.fetch;
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
  const runtime=startBackend('basket-20-delayed');const root=await mount();
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
  const values=new Map();let runtime=startBackend('register-partial',values);let root=await mount();
  try{
    await click(t('registerAll'));
    assert.match(document.body.textContent,/6 of 38 registrations submitted/);
    assert.match(document.body.textContent,/Controlled seventh-registration preparation failure/);
    assert.equal(document.querySelectorAll('.register-all code').length,6);
    let evidence=(await runtime.describe()).registration;
    assert.equal(evidence.inertBoundaryCalls,6);
    await act(async()=>root.unmount());
    runtime=startBackend('register-partial',values);root=await mount();
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
  const values=new Map();let runtime=startBackend('register-ambiguous',values);let root=await mount();
  try{
    await click(t('registerAll'));
    assert.match(document.body.textContent,/Broadcast status is uncertain/);
    assert(document.querySelector('.register-all button').disabled);
    const txid=document.querySelector('.register-all code').textContent;
    await act(async()=>root.unmount());
    runtime=startBackend('register-ambiguous',values);root=await mount();
    assert(document.querySelector('.register-all button').disabled);
    assert.equal(document.querySelector('.register-all code').textContent,txid);
    await runtime.walletMethods.sendRegisterAll(undefined,{walletId:'acceptance-primary',network:'regtest',operationId:'duplicate'});
    assert.equal((await runtime.describe()).registration.constructionCalls,1);
    assert.equal((await runtime.describe()).registration.inertBoundaryCalls,1);
  }finally{await act(async()=>root.unmount());window.localStorage.clear();}
});

test('actual Register All Stop and navigation cancel inert delayed work with no later boundary',async()=>{
  const runtime=startBackend('register-cancel');const root=await mount();
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

test('registration fixture refuses non-fixed contexts and protects durable records from renderer writes',async()=>{
  const runtime=startBackend('register-partial');
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
  startBackend('multiwallet');
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
