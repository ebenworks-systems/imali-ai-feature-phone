import { describe, expect, it, vi } from 'vitest';
import { africasTalkingHost, createAfricasTalkingSender } from '../../src/server/sender.js';

const KEY = 'test-key-not-real';

function okResponse(recipients: unknown[] = [{ statusCode: 101, number: '+27000001234', status: 'Success' }]) {
  return new Response(JSON.stringify({ SMSMessageData: { Message: 'Sent to 1/1', Recipients: recipients } }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** A fake fetch. It throws if it is given a URL the test did not expect, so nothing can reach the network. */
function fakeFetch(allowedUrl: string, answer: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== allowedUrl) throw new Error(`unexpected URL ${url}`);
    calls.push({ url, init: init ?? {} });
    return answer();
  });
  return { fetch: fn as unknown as typeof fetch, calls, fn };
}

describe('africasTalkingHost', () => {
  it('uses the sandbox host for the username sandbox and the live host otherwise', () => {
    expect(africasTalkingHost('sandbox')).toBe('https://api.sandbox.africastalking.com');
    expect(africasTalkingHost('imali')).toBe('https://api.africastalking.com');
    expect(africasTalkingHost('Sandbox')).toBe('https://api.africastalking.com');
  });
});

describe('createAfricasTalkingSender', () => {
  it('makes one POST to the sandbox messaging endpoint with the form fields and the headers', async () => {
    const { fetch, calls } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () => okResponse());
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
    await sender.send('+27000001234', 'Saved: sale R45 (3 bread).');

    expect(calls).toHaveLength(1);
    const { init } = calls[0]!;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.apiKey).toBe(KEY);
    expect(headers.Accept).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      username: 'sandbox',
      to: '+27000001234',
      message: 'Saved: sale R45 (3 bread).',
      from: '46254'
    });
  });

  it('uses the live host for another username and the short code it was given as from', async () => {
    const { fetch, calls } = fakeFetch('https://api.africastalking.com/version1/messaging', () => okResponse());
    const sender = createAfricasTalkingSender({ username: 'imali', apiKey: KEY, shortcode: '12345', fetch });
    await sender.send('+254711000000', 'hello');
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('from')).toBe('12345');
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('username')).toBe('imali');
  });

  it('encodes a message with an ampersand, a plus and a newline so it arrives whole', async () => {
    const { fetch, calls } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () => okResponse());
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
    await sender.send('+27000001234', 'a&b=c+d\ne');
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('message')).toBe('a&b=c+d\ne');
  });

  it('throws on a 500 answer, naming the status and not the key', async () => {
    const { fetch } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () => new Response('nope', { status: 500 }));
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
    const error = await sender.send('+27000001234', 'hi').catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('500');
    expect(error.message).not.toContain(KEY);
  });

  it('throws on a 401 answer', async () => {
    const { fetch } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () => new Response('', { status: 401 }));
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
    await expect(sender.send('+27000001234', 'hi')).rejects.toThrow(/401/);
  });

  it('throws when a recipient has a statusCode of 400 or more', async () => {
    const { fetch } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () =>
      okResponse([{ statusCode: 403, number: '+27000001234', status: 'InvalidPhoneNumber' }])
    );
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
    const error = await sender.send('+27000001234', 'hi').catch((e: unknown) => e as Error);
    expect(error.message).toContain('403');
    expect(error.message).not.toContain(KEY);
  });

  it('accepts recipients with status codes 100, 101 and 102', async () => {
    for (const statusCode of [100, 101, 102]) {
      const { fetch } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () => okResponse([{ statusCode }]));
      const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
      await expect(sender.send('+27000001234', 'hi')).resolves.toBeUndefined();
    }
  });

  it('throws when the answer is not JSON', async () => {
    const { fetch } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () => new Response('<html>', { status: 200 }));
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
    await expect(sender.send('+27000001234', 'hi')).rejects.toThrow(/could not be read/);
  });

  it('gives up after the timeout when fetch never answers, even if it ignores the abort signal', async () => {
    const { fetch } = fakeFetch('https://api.sandbox.africastalking.com/version1/messaging', () => new Promise<Response>(() => {}));
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch, timeoutMs: 20 });
    const started = Date.now();
    const error = await sender.send('+27000001234', 'hi').catch((e: unknown) => e as Error);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(error.message).toMatch(/did not answer in time/);
    expect(error.message).not.toContain(KEY);
  });

  it('aborts the request when the timeout passes', async () => {
    let signal: AbortSignal | undefined;
    const slow = vi.fn(async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const sender = createAfricasTalkingSender({
      username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch: slow as unknown as typeof fetch, timeoutMs: 20
    });
    await sender.send('+27000001234', 'hi').catch(() => {});
    expect(signal?.aborted).toBe(true);
  });

  it('hides a network error that carries the key, and keeps no cause', async () => {
    const leaky = vi.fn(async () => {
      throw new TypeError(`fetch failed for header apiKey=${KEY}`);
    });
    const sender = createAfricasTalkingSender({
      username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch: leaky as unknown as typeof fetch
    });
    const error = await sender.send('+27000001234', 'hi').catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(KEY);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(error.stack)).not.toContain(KEY);
  });

  it('never calls the real network when no fetch is given a chance: the fake throws on another URL', async () => {
    const { fetch } = fakeFetch('https://example.invalid/', () => okResponse());
    const sender = createAfricasTalkingSender({ username: 'sandbox', apiKey: KEY, shortcode: '46254', fetch });
    await expect(sender.send('+27000001234', 'hi')).rejects.toThrow(/could not be reached/);
  });
});
