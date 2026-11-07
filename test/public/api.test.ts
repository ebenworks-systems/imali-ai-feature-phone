import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ROUTES, createApi, exportUrl, isShopGone, ledgerUrl } from '../../public/api.js';

type Call = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFetch(make: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return make(url, init);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected the call to fail');
}

describe('api helper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('postJson sends JSON, omits credentials and returns the parsed answer', async () => {
    const { fetchFn, calls } = fakeFetch(async () => jsonResponse({ response: 'CON Hi', length: 2, limit: 182 }));
    const api = createApi({ fetchFn });
    const answer = await api.postJson('/api/phone/ussd', { phone: '+27000000001', sessionId: 'a', text: '' });
    expect(answer).toEqual({ response: 'CON Hi', length: 2, limit: 182 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/phone/ussd');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('omit');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ phone: '+27000000001', sessionId: 'a', text: '' });
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('getJson sends a GET with credentials omitted', async () => {
    const { fetchFn, calls } = fakeFetch(async () => jsonResponse({ ok: 1 }));
    const api = createApi({ fetchFn });
    expect(await api.getJson('/api/ledger?phone=x')).toEqual({ ok: 1 });
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.credentials).toBe('omit');
  });

  it('getBlob returns the body as a blob', async () => {
    const { fetchFn } = fakeFetch(async () => new Response('{"records":[]}', { status: 200 }));
    const api = createApi({ fetchFn });
    const blob = await api.getBlob('/api/export?phone=x');
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('{"records":[]}');
  });

  it('times out at 10 seconds with kind "timeout" and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    const { fetchFn } = fakeFetch((_url, init) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    const api = createApi({ fetchFn });
    const pending = failureOf(api.postJson('/api/phone/sms', { phone: 'p', text: 't' }));
    await vi.advanceTimersByTimeAsync(9999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error.kind).toBe('timeout');
    expect(signal?.aborted).toBe(true);
  });

  it('does not time out when the answer arrives in time, and clears its timer', async () => {
    const { fetchFn } = fakeFetch(async () => jsonResponse({ ok: true }));
    const api = createApi({ fetchFn });
    await api.getJson('/x');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a custom timeout', async () => {
    const { fetchFn } = fakeFetch(() => new Promise<Response>(() => {}));
    const api = createApi({ fetchFn, timeoutMs: 50 });
    const pending = failureOf(api.getJson('/x'));
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).kind).toBe('timeout');
  });

  it('turns a rejected fetch into kind "network"', async () => {
    const { fetchFn } = fakeFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = createApi({ fetchFn });
    const error = await failureOf(api.postJson('/x', {}));
    expect(error.kind).toBe('network');
    expect(error.status).toBeUndefined();
  });

  it.each([404, 409, 500])('turns a %i answer into kind "http" with the status', async (status) => {
    const { fetchFn } = fakeFetch(async () => jsonResponse({ error: 'no' }, status));
    const api = createApi({ fetchFn });
    const error = await failureOf(api.getJson('/x'));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(status);
  });

  it('does not read the body of an error answer', async () => {
    const json = vi.fn();
    const response = { ok: false, status: 500, json } as unknown as Response;
    const { fetchFn } = fakeFetch(async () => response);
    const error = await failureOf(createApi({ fetchFn }).getJson('/x'));
    expect(error.kind).toBe('http');
    expect(json).not.toHaveBeenCalled();
  });

  it('turns a body that is not JSON into kind "json"', async () => {
    const { fetchFn } = fakeFetch(async () => new Response('<html>oops</html>', { status: 200 }));
    const api = createApi({ fetchFn });
    expect((await failureOf(api.getJson('/x'))).kind).toBe('json');
    expect((await failureOf(api.postJson('/x', {}))).kind).toBe('json');
  });

  it('times out a fetch that ignores the abort signal', async () => {
    const { fetchFn } = fakeFetch(() => new Promise<Response>(() => {}));
    const api = createApi({ fetchFn });
    const pending = failureOf(api.getBlob('/x'));
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).kind).toBe('timeout');
  });

  it('does not leave an unhandled rejection when the answer fails after the timeout', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let rejectLate: (reason: unknown) => void = () => {};
    const { fetchFn } = fakeFetch(() => new Promise<Response>((_resolve, reject) => (rejectLate = reject)));
    const api = createApi({ fetchFn });
    const pending = failureOf(api.getJson('/x'));
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    rejectLate(new Error('late'));
    await vi.advanceTimersByTimeAsync(10);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('api urls', () => {
  it('encodes + as %2B', () => {
    expect(ledgerUrl('+27000001234')).toBe('/api/ledger?phone=%2B27000001234');
    expect(exportUrl('+27000001234')).toBe('/api/export?phone=%2B27000001234');
  });

  it('encodes spaces and other characters', () => {
    expect(ledgerUrl('+27 00 &x=1')).toBe('/api/ledger?phone=%2B27%2000%20%26x%3D1');
  });
});

describe('isShopGone: the server says there is no demo shop on the number', () => {
  it('is true for a 404 from the ussd, sms and ledger routes, which return the page to the first-visit state', async () => {
    const noShop = { error: 'No demo shop on this number. Press Start demo shop.' };
    const { fetchFn } = fakeFetch(async () => jsonResponse(noShop, 404));
    const api = createApi({ fetchFn });
    const phone = '+27000001234';
    const calls = [
      api.postJson(ROUTES.ussd, { phone, sessionId: 'a', text: 'A*1' }),
      api.postJson(ROUTES.sms, { phone, text: 'hi' }),
      api.getJson(ledgerUrl(phone))
    ];
    for (const call of calls) {
      const error = await call.then(
        () => null,
        (e: unknown) => e
      );
      expect(isShopGone(error)).toBe(true);
    }
  });

  it.each([400, 409, 429, 500, 503])('is false for a %i answer, which keeps the number', async (status) => {
    const { fetchFn } = fakeFetch(async () => jsonResponse({ error: 'x' }, status));
    const error = await failureOf(createApi({ fetchFn }).postJson(ROUTES.sms, { phone: '+27000001234', text: 'x' }));
    expect(isShopGone(error)).toBe(false);
  });

  it('is false for a network failure, a timeout and anything that is not an ApiError', async () => {
    const { fetchFn } = fakeFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await failureOf(createApi({ fetchFn }).postJson(ROUTES.ussd, {}));
    expect(error.kind).toBe('network');
    expect(isShopGone(error)).toBe(false);
    expect(isShopGone(new Error('404'))).toBe(false);
    expect(isShopGone(null)).toBe(false);
    expect(isShopGone(undefined)).toBe(false);
  });
});
