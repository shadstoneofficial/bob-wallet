// Keep successful shutdown stages closed. A retry resumes at the failed stage;
// callers share any still-running attempt, including after a UI timeout.
export function createShutdownSequence(stages) {
  let next = 0;
  let pending = null;
  return function shutdown() {
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        while (next < stages.length) {
          await stages[next]();
          next += 1;
        }
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}
