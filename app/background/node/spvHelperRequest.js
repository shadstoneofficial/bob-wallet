// Only these read-only RPCs may be replayed after a throttle response.
const READ_ONLY_RPC = new Set([
  'estimatesmartfee', 'getblockbyheight', 'getblockchaininfo',
  'getnamebyhash', 'getnameinfo', 'verifymessage',
]);
const MAX_RETRIES = 2;
const RETRY_BUDGET_MS = 125000;
const REQUEST_TIMEOUT_MS = 30000;
let nextRequestGeneration = 1;

function developmentTrace(details) {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[request-lifecycle]', details);
  }
}

export function retryAfterMs(headers, now) {
  const value = (headers.get('retry-after') || '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) ? delay : Infinity;
  }
  // Do not let Date.parse interpret malformed numeric delays as calendar dates.
  if (!/^[A-Za-z]/.test(value)) return null;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  const serverDate = Date.parse(headers.get('date') || '');
  return Math.max(0, date - (Number.isFinite(serverDate) ? serverDate : now));
}

export function createSpvHelperClient({
  fetchImpl = (...args) => fetch(...args),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  random = Math.random,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  trace = developmentTrace,
} = {}) {
  async function request(url, options, retryable) {
    const deadline = now() + RETRY_BUDGET_MS;
    const requestGeneration = nextRequestGeneration++;
    const startedAt = now();
    for (let attempt = 0; ; attempt++) {
      trace({
        operation: options.method === 'GET' ? 'spv-helper-read' : 'spv-helper-rpc',
        caller: 'spvHelperRequest',
        requestGeneration,
        attempt: attempt + 1,
        event: 'start',
        elapsedMs: now() - startedAt,
        statusCategory: 'pending',
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {...options, signal: controller.signal});
      } catch (error) {
        if (controller.signal.aborted) {
          const timeoutError = new Error('SPV helper request timed out.');
          timeoutError.code = 'ETIMEDOUT';
          timeoutError.status = 408;
          trace({
            operation: options.method === 'GET' ? 'spv-helper-read' : 'spv-helper-rpc',
            caller: 'spvHelperRequest',
            requestGeneration,
            attempt: attempt + 1,
            event: 'cancellation',
            elapsedMs: now() - startedAt,
            statusCategory: 'timeout',
          });
          throw timeoutError;
        }
        trace({
          operation: options.method === 'GET' ? 'spv-helper-read' : 'spv-helper-rpc',
          caller: 'spvHelperRequest',
          requestGeneration,
          attempt: attempt + 1,
          event: 'completion',
          elapsedMs: now() - startedAt,
          statusCategory: 'network-error',
        });
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      const throttled = response.status === 429 || response.status === 503;
      if (!throttled || !retryable || attempt >= MAX_RETRIES) {
        trace({
          operation: options.method === 'GET' ? 'spv-helper-read' : 'spv-helper-rpc',
          caller: 'spvHelperRequest',
          requestGeneration,
          attempt: attempt + 1,
          event: 'completion',
          elapsedMs: now() - startedAt,
          statusCategory: response.status >= 400 ? 'http-error' : 'success',
        });
        return response;
      }

      const serverDelay = retryAfterMs(response.headers, now());
      const delay = (serverDelay === null ? 1000 * (2 ** attempt) : serverDelay)
        + Math.floor(random() * 250) + 1;
      // Never shorten the server's delay to fit our budget: return the 429 instead.
      if (delay > deadline - now()) {
        trace({
          operation: options.method === 'GET' ? 'spv-helper-read' : 'spv-helper-rpc',
          caller: 'spvHelperRequest',
          requestGeneration,
          attempt: attempt + 1,
          event: 'completion',
          elapsedMs: now() - startedAt,
          statusCategory: 'retry-budget-exceeded',
        });
        return response;
      }

      trace({
        operation: options.method === 'GET' ? 'spv-helper-read' : 'spv-helper-rpc',
        caller: 'spvHelperRequest',
        requestGeneration,
        attempt: attempt + 1,
        event: 'retry-scheduled',
        elapsedMs: now() - startedAt,
        statusCategory: 'throttled',
        retryReason: `http-${response.status}`,
      });

      // Drain the discarded response before reusing the connection, even if the
      // throttle body is HTML or empty. Only the final response is parsed as JSON.
      await response.text();
      await sleep(delay);
      // A suspended machine may wake after the budget has expired.
      if (now() > deadline) {
        const error = new Error('SPV helper rate limit retry budget exceeded.');
        error.status = 429;
        trace({
          operation: options.method === 'GET' ? 'spv-helper-read' : 'spv-helper-rpc',
          caller: 'spvHelperRequest',
          requestGeneration,
          attempt: attempt + 1,
          event: 'completion',
          elapsedMs: now() - startedAt,
          statusCategory: 'retry-budget-exceeded',
        });
        throw error;
      }
    }
  }

  async function read(response, method) {
    const json = await response.json();
    if (!json)
      throw new Error(method === 'GET' ? 'Bad response (no body).' : 'No body for JSON-RPC response.');
    if (json.error && (method === 'POST' || response.status >= 400)) {
      const error = new Error(json.error.message);
      error.type = String(json.error.type);
      error.code = json.error.code;
      error.status = response.status;
      throw error;
    }
    if (response.status !== 200) {
      const error = new Error(`Status code: ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return json;
  }

  return {
    async get(baseUrl, path = '') {
      const response = await request(baseUrl + path, {
        method: 'GET', headers: {'Content-Type': 'application/json'},
      }, true);
      return read(response, 'GET');
    },
    async post(baseUrl, path = '', body) {
      const retryable = path === '/tx/address'
        || (path === '' && body && READ_ONLY_RPC.has(body.method));
      const response = await request(baseUrl + path, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      }, retryable);
      return read(response, 'POST');
    },
  };
}
