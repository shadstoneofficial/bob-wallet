const crypto = require('crypto');

const BASKET_NAMES = Object.freeze([
  'fixture-01', 'fixture-02', 'fixture-03', 'fixture-04', 'fixture-05',
  'fixture-06', 'fixture-07', 'fixture-08', 'fixture-09', 'fixture-10',
  'fixture-11', 'fixture-12', 'fixture-13', 'fixture-14', 'fixture-15',
  'fixture-16', 'fixture-17', 'fixture-18', 'fixture-19', 'fixture-20',
]);

const SCENARIO_DEFINITIONS = Object.freeze({
  multiwallet: Object.freeze({nodeMode: 'spv', fixtureType: 'multiwallet'}),
  'restore-spv': Object.freeze({nodeMode: 'spv', fixtureType: 'restore-history'}),
  'restore-full': Object.freeze({nodeMode: 'full', fixtureType: 'restore-history'}),
  'auction-retry': Object.freeze({nodeMode: 'spv', fixtureType: 'auction-retry'}),
  'basket-20-delayed': Object.freeze({nodeMode: 'spv', fixtureType: 'basket-delayed'}),
  'basket-ambiguous': Object.freeze({nodeMode: 'spv', fixtureType: 'basket-ambiguous'}),
});

function getScenarioDefinition(scenario) {
  return SCENARIO_DEFINITIONS[scenario] || null;
}

function hashFixture(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createGeneratedRestoreHistory(scenario) {
  const entries = Array.from({length: 12}, (_, index) => ({
    height: 100 + index,
    txHash: hashFixture(`${scenario}:generated-history:${index}`),
    value: (index + 1) * 1000000,
  }));
  return {
    source: 'generated-disposable-history',
    walletIds: ['restore-source', 'restore-target-a', 'restore-target-b'],
    entries,
    expectedBalance: entries.reduce((total, entry) => total + entry.value, 0),
    digest: hashFixture(JSON.stringify(entries)),
    containsRecoveryMaterial: false,
  };
}

function buildControlledScenarioPlan(scenario) {
  const definition = getScenarioDefinition(scenario);
  if (!definition) throw new Error(`Unsupported packaged acceptance scenario: ${scenario}.`);
  const base = {
    scenario,
    nodeMode: definition.nodeMode,
    fixtureType: definition.fixtureType,
    network: 'regtest',
    externalTransactionNetwork: false,
    signingAllowed: false,
    broadcastAllowed: false,
    evidenceClass: definition.fixtureType.startsWith('basket') || definition.fixtureType === 'auction-retry'
      ? 'source-product-path'
      : 'source-plan-only',
  };
  if (definition.fixtureType === 'restore-history') {
    return {
      ...base,
      generatedHistory: createGeneratedRestoreHistory(scenario),
      replayPlan: {
        sequentialTargets: ['restore-target-a', 'restore-target-b'],
        overlappingRequests: 5,
        injectFirstFailure: true,
        requiredCapability: 'reviewed-wallet-replay-target',
      },
    };
  }
  if (definition.fixtureType === 'auction-retry') {
    return {...base, name: 'fixture-auction-retry', failureBoundary: 'pre-signing'};
  }
  if (definition.fixtureType === 'basket-delayed') {
    return {...base, names: [...BASKET_NAMES], constructionBoundary: 'inert-delayed'};
  }
  if (definition.fixtureType === 'basket-ambiguous') {
    return {
      ...base,
      names: [...BASKET_NAMES],
      inertPayloadDigest: hashFixture('bob-acceptance-inert-ambiguous-payload'),
      maximumBoundaryCalls: 1,
    };
  }
  return base;
}

function pendingProductFixture(plan) {
  return {
    status: 'PENDING',
    reason: 'source-product-fixture-adapter-unavailable',
    fixtureType: plan.fixtureType,
    packagedUiStatus: 'NOT TESTED',
  };
}

function assertProductEvidence(condition, message) {
  if (!condition) {
    const error = new Error(`Controlled product fixture failed: ${message}`);
    error.code = 'ERR_ACCEPTANCE_PRODUCT_FIXTURE';
    throw error;
  }
}

function validateAuctionRetryEvidence(result) {
  assertProductEvidence(result?.productPath?.includes('AuctionBasket.onSubmit'), 'AuctionBasket UI path was not exercised.');
  assertProductEvidence(result?.productPath?.includes('sendBidMany'), 'sendBidMany action was not exercised.');
  assertProductEvidence(result?.productPath?.includes('submitBidManyLifecycle'), 'submission coordinator was not exercised.');
  assertProductEvidence(result.firstFailure?.phase === 'failed', 'the real error was not retained in failed UI state.');
  assertProductEvidence(result.firstFailure?.failedStage === 'building', 'the failure did not remain at the construction boundary.');
  assertProductEvidence(result.firstFailure?.retryAllowed === true, 'Retry was not offered after a pre-signing failure.');
  assertProductEvidence(result.firstFailure?.visibleErrors > 0, 'the real error was not surfaced through the UI notification path.');
  assertProductEvidence(result.retryAttempted === true && result.preparationCalls === 2, 'Retry did not re-enter real construction exactly once.');
  assertProductEvidence(result.inertBroadcastCalls === 0 && result.liveBroadcastCalls === 0, 'a broadcast boundary was reached.');
  assertProductEvidence(result.basketNamesPreserved === 1, 'the failed basket was not preserved.');
}

function validateDelayedBasketEvidence(result, plan) {
  assertProductEvidence(result?.productPath?.includes('AuctionBasket.onSubmit/onBackToBasket'), 'AuctionBasket navigation path was not exercised.');
  assertProductEvidence(result?.productPath?.includes('sendBidMany'), 'sendBidMany action was not exercised.');
  assertProductEvidence(result.namesSubmitted === plan.names.length, 'the real action did not receive every basket row.');
  assertProductEvidence(result.namesPreserved === plan.names.length, 'back navigation changed the basket.');
  assertProductEvidence(result.preparationCalls === 1, 'construction did not start exactly once.');
  assertProductEvidence(result.cancelCalls >= 1, 'the real cancellation adapter was not invoked.');
  assertProductEvidence(result.returnedToEdit === true, 'back navigation did not restore edit state.');
  assertProductEvidence(result.cancellationStopsContinuation === true, 'late construction continued after cancellation.');
  assertProductEvidence(result.inertBroadcastCalls === 0 && result.liveBroadcastCalls === 0, 'cancelled construction reached a broadcast boundary.');
  assertProductEvidence(result.basketClears === 0, 'the basket was cleared without a transaction.');
}

function validateAmbiguousBasketEvidence(result, plan) {
  assertProductEvidence(result?.productPath?.includes('AuctionBasket draft/navigation'), 'AuctionBasket reuse path was not exercised.');
  assertProductEvidence(result?.productPath?.includes('sendBidMany duplicate lock'), 'sendBidMany duplicate lock was not exercised.');
  assertProductEvidence(result.firstFailure?.failedStage === 'broadcasting', 'ambiguous failure was not attributed to broadcasting.');
  assertProductEvidence(result.firstFailure?.retryAllowed === false, 'ambiguous failure incorrectly enabled Retry.');
  assertProductEvidence(result.firstFailure?.broadcastUncertain === true, 'ambiguous state was not retained.');
  assertProductEvidence(result.firstFailure?.visibleErrors > 0, 'ambiguous failure was not visible.');
  assertProductEvidence(result.persistedLock === true, 'navigation/profile reuse did not restore the safety lock.');
  assertProductEvidence(result.duplicateBlockedAfterReuse === true, 'the product action did not block duplicate submission after reuse.');
  assertProductEvidence(result.preparationCalls === 1, 'duplicate navigation caused another construction.');
  assertProductEvidence(result.inertBroadcastCalls === plan.maximumBoundaryCalls, 'ambiguous boundary call count changed.');
  assertProductEvidence(result.liveBroadcastCalls === 0, 'a live broadcast was attempted.');
  assertProductEvidence(result.basketNamesPreserved === plan.names.length, 'the ambiguous basket was not preserved.');
}

async function executeControlledSourceFixture(plan, {restoreReplay, productAdapter} = {}) {
  switch (plan.fixtureType) {
    case 'restore-history': {
      if (typeof restoreReplay !== 'function') {
        return {
          status: 'PENDING',
          reason: 'reviewed-wallet-replay-target-unavailable',
          generatedHistoryDigest: plan.generatedHistory.digest,
        };
      }
      const calls = [];
      for (const walletId of plan.replayPlan.sequentialTargets) {
        calls.push(await restoreReplay({walletId, history: plan.generatedHistory, mode: 'sequential'}));
      }
      const overlaps = await Promise.all(Array.from(
        {length: plan.replayPlan.overlappingRequests},
        (_, index) => restoreReplay({
          walletId: `restore-overlap-${index + 1}`,
          history: plan.generatedHistory,
          mode: 'overlap',
        }),
      ));
      let firstFailureObserved = false;
      try {
        await restoreReplay({
          walletId: 'restore-first-failure',
          history: plan.generatedHistory,
          mode: 'inject-first-failure',
          attempt: 1,
        });
      } catch (error) {
        firstFailureObserved = true;
      }
      const retry = await restoreReplay({
        walletId: 'restore-first-failure',
        history: plan.generatedHistory,
        mode: 'inject-first-failure',
        attempt: 2,
      });
      return {
        status: 'SOURCE FIXTURE READY',
        sequentialResults: calls.length,
        overlappingResults: overlaps.length,
        firstFailureObserved,
        retrySucceeded: Boolean(retry),
        packagedBackendStatus: 'NOT TESTED',
      };
    }
    case 'auction-retry': {
      if (typeof productAdapter?.runAuctionRetry !== 'function') return pendingProductFixture(plan);
      const evidence = await productAdapter.runAuctionRetry(plan);
      validateAuctionRetryEvidence(evidence);
      return {
        status: 'SOURCE PRODUCT PATH READY',
        evidence,
        packagedUiStatus: 'NOT TESTED',
      };
    }
    case 'basket-delayed': {
      if (typeof productAdapter?.runDelayedBasket !== 'function') return pendingProductFixture(plan);
      const evidence = await productAdapter.runDelayedBasket(plan);
      validateDelayedBasketEvidence(evidence, plan);
      return {
        status: 'SOURCE PRODUCT PATH READY',
        evidence,
        packagedUiStatus: 'NOT TESTED',
      };
    }
    case 'basket-ambiguous': {
      if (typeof productAdapter?.runAmbiguousBasket !== 'function') return pendingProductFixture(plan);
      const evidence = await productAdapter.runAmbiguousBasket(plan);
      validateAmbiguousBasketEvidence(evidence, plan);
      return {
        status: 'SOURCE PRODUCT PATH READY',
        evidence,
        inertPayloadDigest: plan.inertPayloadDigest,
        packagedUiStatus: 'NOT TESTED',
      };
    }
    default:
      return {status: 'READY', packagedUiStatus: 'MANUAL'};
  }
}

module.exports = {
  BASKET_NAMES,
  SCENARIO_DEFINITIONS,
  buildControlledScenarioPlan,
  createGeneratedRestoreHistory,
  executeControlledSourceFixture,
  getScenarioDefinition,
};
