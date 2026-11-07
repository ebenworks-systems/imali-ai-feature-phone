// The api helper: every network call the page makes goes through here, so the routes are easy to adjust.
// No DOM. `fetch` is passed in, so tests can use a fake one.

/** The one error type the page sees. kind: 'network' | 'timeout' | 'http' | 'json'. */
export class ApiError extends Error {
  /**
   * @param {'network' | 'timeout' | 'http' | 'json'} kind
   * @param {string} message
   * @param {number} [status] set when kind is 'http'
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

/**
 * True when the server says there is no demo shop on the number: a 404 from the ledger, ussd or sms route. The shop
 * was never made, or it was cleared away (demo shops last about a week). The page then returns to the first-visit state.
 */
export function isShopGone(error) {
  return error instanceof ApiError && error.kind === 'http' && error.status === 404;
}

/** Route paths in one place. */
export const ROUTES = {
  ussd: '/api/phone/ussd',
  sms: '/api/phone/sms',
  demo: '/api/phone/demo',
  ledger: '/api/ledger',
  export: '/api/export',
};

/** '/api/ledger?phone=%2B2700000xxxx'. A bare + would reach the server as a space. */
export function ledgerUrl(phone) {
  return `${ROUTES.ledger}?phone=${encodeURIComponent(phone)}`;
}

export function exportUrl(phone) {
  return `${ROUTES.export}?phone=${encodeURIComponent(phone)}`;
}

/**
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [options]
 */
export function createApi({ fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) {
  /**
   * @template T
   * @param {string} url
   * @param {RequestInit} init
   * @param {(response: Response) => Promise<T>} read
   * @returns {Promise<T>}
   */
  async function request(url, init, read) {
    const controller = new AbortController();
    let timer;
    // The timeout rejects on its own, so a fetch that ignores the abort signal still times out.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError('timeout', 'The request took too long'));
      }, timeoutMs);
    });

    const work = (async () => {
      let response;
      try {
        response = await fetchFn(url, { ...init, signal: controller.signal, credentials: 'omit' });
      } catch {
        throw new ApiError('network', 'The request failed');
      }
      // The body of an error answer is never read: the page shows its own words (assumption A4).
      if (!response.ok) throw new ApiError('http', `The server answered ${response.status}`, response.status);
      try {
        return await read(response);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(error instanceof SyntaxError ? 'json' : 'network', 'The answer could not be read');
      }
    })();
    work.catch(() => {}); // when the timeout wins, a late failure here must not become an unhandled rejection

    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  const readJson = (response) => response.json();

  return {
    /** @returns {Promise<any>} */
    postJson(url, body) {
      return request(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        },
        readJson,
      );
    },
    /** @returns {Promise<any>} */
    getJson(url) {
      return request(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' }, readJson);
    },
    /** @returns {Promise<Blob>} */
    getBlob(url) {
      return request(url, { method: 'GET', cache: 'no-store' }, (response) => response.blob());
    },
  };
}
