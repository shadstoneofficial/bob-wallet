let nextRequestId = 1;

export function startRequestTrace({operation, caller, walletGeneration, attempt = 1}) {
  if (process.env.NODE_ENV !== 'development') {
    return {
      complete() {},
      cancel() {},
      fail() {},
    };
  }

  const requestGeneration = nextRequestId++;
  const startedAt = Date.now();
  const write = (event, statusCategory) => console.debug('[request-lifecycle]', {
    operation,
    caller,
    walletGeneration,
    requestGeneration,
    attempt,
    event,
    elapsedMs: Date.now() - startedAt,
    statusCategory,
  });

  write('start', 'pending');
  return {
    complete: () => write('completion', 'success'),
    cancel: () => write('cancellation', 'cancelled'),
    fail: () => write('completion', 'error'),
  };
}
