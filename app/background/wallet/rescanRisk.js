export function createRescanRiskTracker() {
  const attempted = new Set();

  return {
    track(transactionAttempted) {
      const token = {};
      if (transactionAttempted) attempted.add(token);
      return () => attempted.delete(token);
    },
    get transactionAttempted() {
      return attempted.size > 0;
    },
  };
}
