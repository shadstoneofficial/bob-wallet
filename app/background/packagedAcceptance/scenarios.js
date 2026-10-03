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
    evidenceClass: 'source-simulation-only',
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

async function executeControlledSourceFixture(plan, {restoreReplay} = {}) {
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
      let attempts = 0;
      const review = async () => {
        attempts += 1;
        if (attempts === 1) {
          const failure = new Error('Fixture pre-signing failure.');
          failure.code = 'ERR_ACCEPTANCE_PRE_SIGN';
          throw failure;
        }
        return {safeToRetry: true};
      };
      let error;
      try {
        await review();
      } catch (failure) {
        error = failure;
      }
      const retry = await review();
      return {
        status: 'SOURCE FIXTURE READY',
        retainedError: {code: error.code, message: error.message},
        reviewAttempts: attempts,
        retryAvailable: retry.safeToRetry,
        signingCalls: 0,
        broadcastCalls: 0,
        packagedUiStatus: 'NOT TESTED',
      };
    }
    case 'basket-delayed': {
      let constructionCalls = 0;
      let cancelled = false;
      const construct = async () => {
        constructionCalls += 1;
        await Promise.resolve();
        return {continued: !cancelled};
      };
      const pending = construct();
      cancelled = true;
      const construction = await pending;
      return {
        status: 'SOURCE FIXTURE READY',
        namesPreserved: plan.names.length,
        constructionCalls,
        cancellationStopsContinuation: !construction.continued,
        signingCalls: 0,
        broadcastCalls: 0,
        packagedUiStatus: 'NOT TESTED',
      };
    }
    case 'basket-ambiguous': {
      let boundaryCalls = 0;
      let retryLocked = false;
      const boundary = async () => {
        boundaryCalls += 1;
        retryLocked = true;
        return {outcome: 'unknown'};
      };
      const result = await boundary();
      if (!retryLocked) await boundary();
      return {
        status: 'SOURCE FIXTURE READY',
        boundaryCalls,
        outcome: result.outcome,
        retryLocked,
        inertPayloadDigest: plan.inertPayloadDigest,
        signingCalls: 0,
        liveBroadcastCalls: 0,
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
