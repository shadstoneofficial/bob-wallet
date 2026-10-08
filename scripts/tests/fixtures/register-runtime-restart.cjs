const assert = require('node:assert/strict');
const path = require('node:path');
const bdb = require('bdb');
require('@babel/register')({configFile:false,babelrc:false,
  presets:[['@babel/preset-env',{targets:{node:'current'}}]]});
const {createProductRuntime} = require('../../../app/background/packagedAcceptance/productRuntime');
(async () => {
  const db = bdb.create({location:path.join(process.argv[2],'db'),memory:false});
  await db.open();
  try {
    const adapter = {get:async key => {const value=await db.get(Buffer.from(key));return value?JSON.parse(value):null;},
      put:(key,value)=>db.put(Buffer.from(key),Buffer.from(JSON.stringify(value)))};
    const runtime = createProductRuntime({scenario:'register-ambiguous'},adapter);
    const context = {walletId:'acceptance-primary',network:'regtest',operationId:process.argv[3]};
    const result = await runtime.walletMethods.sendRegisterAll(undefined,context);
    assert.equal(result.retryLocked,true);
    const status = await runtime.walletMethods.getRegisterAllStatus(context);
    assert.equal(status.retryLocked,true);
    const evidence = (await runtime.describe()).registration;
    assert.equal(evidence.inertBoundaryCalls,1);
    assert.equal(evidence.constructionCalls,1);
    assert.equal(evidence.liveBroadcastCalls,0);
    assert.equal(evidence.signatureCalls,0);
    console.log(JSON.stringify({txid:status.entries[0].txid,...evidence}));
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
