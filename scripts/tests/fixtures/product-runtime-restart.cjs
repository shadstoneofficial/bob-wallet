const assert=require('node:assert/strict');
const path=require('node:path');
const bdb=require('bdb');
const {createProductRuntime}=require('../../../app/background/packagedAcceptance/productRuntime');
const {buildControlledScenarioPlan}=require('../../../app/background/packagedAcceptance/scenarios');
(async()=>{
  const db=bdb.create({location:path.join(process.argv[2],'db'),memory:false});
  await db.open();
  const adapter={get:async key=>{const value=await db.get(Buffer.from(key));return value?JSON.parse(value):null;},put:(key,value)=>db.put(Buffer.from(key),Buffer.from(JSON.stringify(value)))};
  const runtime=createProductRuntime({scenario:'basket-ambiguous'},adapter);
  const rows=buildControlledScenarioPlan('basket-ambiguous').names.map(name=>({name,bid:1000000,lockup:2000000}));
  if(process.argv[3]==='first'){
    const quote=await runtime.walletMethods.prepareBidMany(rows,'basket-123-abc');
    await runtime.walletMethods.signPreparedBidMany('basket-123-abc',quote.scope);
    await assert.rejects(runtime.walletMethods.broadcastPreparedBidMany('basket-123-abc'),{code:'ETXBROADCASTUNCERTAIN'});
  }else{
    await assert.rejects(runtime.walletMethods.prepareBidMany(rows,'basket-456-def'),{code:'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  }
  console.log(JSON.stringify((await runtime.describe()).state));
  await db.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
