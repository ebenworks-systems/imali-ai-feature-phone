import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeminiReader,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
  type FetchInitLike,
  type FetchLike,
  type FetchResponseLike
} from '@/ai/reader.ts';

/**
 * No test here touches the network. Every call goes to a fake fetch, and the global fetch is replaced with
 * one that fails the test if it is ever reached.
 */

const FAKE_KEY = 'test-key-for-the-fake-fetch';
const MESSAGE = 'tendai took sugar 20 not paid';

interface Call {
  url: string;
  init: FetchInitLike;
}

/** A fake fetch that records its calls and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Promise<FetchResponseLike> | FetchResponseLike) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

function answer(body: unknown, status = 200): FetchResponseLike {
  return { status, json: async () => body };
}

/** What Gemini sends back: the model's JSON as text in the first candidate. */
function geminiSays(model: unknown): FetchResponseLike {
  const text = typeof model === 'string' ? model : JSON.stringify(model);
  return answer({ candidates: [{ content: { parts: [{ text }] } }] });
}

const GOOD_DEBT = { kind: 'debt', amountText: '20', amountCents: 2000, customerText: 'tendai', item: 'sugar' };

beforeEach(() => {
  // If any test reaches the real fetch, it fails loudly instead of calling out.
  vi.stubGlobal('fetch', () => {
    throw new Error('a test tried to use the network');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GeminiReader: the request', () => {
  it('asks Gemini on Vertex AI, global location, in the given project, with the key still in the header only', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    const reader = new GeminiReader({
      apiKey: FAKE_KEY,
      vertexProject: ' my-project ',
      model: 'gemini-3.8-flash',
      fetch
    });

    expect(await reader.read(MESSAGE)).not.toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent'
    );
    expect(calls[0].url).not.toContain(FAKE_KEY);
    expect(calls[0].init.headers['x-goog-api-key']).toBe(FAKE_KEY);
  });

  it('calls the generateContent endpoint once, with the key in the x-goog-api-key header and never in the URL', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    const reader = new GeminiReader({ apiKey: FAKE_KEY, fetch });

    await reader.read(MESSAGE);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
    );
    expect(url).not.toContain(FAKE_KEY);
    expect(url).not.toContain('key=');
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.body).not.toContain(FAKE_KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('defaults to gemini-2.5-flash and a 4000 ms timeout', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-2.5-flash');
    expect(DEFAULT_GEMINI_TIMEOUT_MS).toBe(4000);
  });

  it('uses the model it is given', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    await new GeminiReader({ apiKey: FAKE_KEY, model: 'gemini-test-model', fetch }).read(MESSAGE);
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent'
    );
  });

  it('asks for JSON only, with a response schema, and sends the owner words as the user content', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(MESSAGE);

    const body = JSON.parse(calls[0].init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT');
    expect(body.generationConfig.responseSchema.properties.kind.enum).toEqual([
      'sale',
      'expense',
      'debt',
      'payment',
      'none'
    ]);
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: MESSAGE }] }]);
  });

  it('tells the model which four things it may propose and to copy the amount and the name exactly', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(MESSAGE);

    const instructions: string = JSON.parse(calls[0].init.body).systemInstruction.parts[0].text;
    for (const word of ['sale', 'expense', 'debt', 'payment']) {
      expect(instructions).toContain(word);
    }
    expect(instructions).toMatch(/exactly as the owner typed/i);
    expect(instructions).toMatch(/amountText/);
    expect(instructions).toMatch(/customerText/);
    // The owner's message is never part of the instructions.
    expect(instructions).not.toContain(MESSAGE);
  });

  it('turns thinking off for Gemini 2.5 Flash only', async () => {
    const flash = fakeFetch(() => geminiSays(GOOD_DEBT));
    await new GeminiReader({ apiKey: FAKE_KEY, fetch: flash.fetch }).read(MESSAGE);
    expect(JSON.parse(flash.calls[0].init.body).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });

    const other = fakeFetch(() => geminiSays(GOOD_DEBT));
    await new GeminiReader({ apiKey: FAKE_KEY, model: 'gemini-test-model', fetch: other.fetch }).read(MESSAGE);
    expect(JSON.parse(other.calls[0].init.body).generationConfig.thinkingConfig).toBeUndefined();
  });

  it('uses the global fetch when none is passed', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    vi.stubGlobal('fetch', fetch);
    const proposal = await new GeminiReader({ apiKey: FAKE_KEY }).read(MESSAGE);
    expect(calls).toHaveLength(1);
    expect(proposal).not.toBeNull();
  });

  it('refuses to be made without a key, without printing one', () => {
    expect(() => new GeminiReader({ apiKey: '' })).toThrow(TypeError);
    expect(() => new GeminiReader({ apiKey: '   ' })).toThrow(TypeError);
  });

  it('makes no call for an empty message', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    const reader = new GeminiReader({ apiKey: FAKE_KEY, fetch });
    expect(await reader.read('')).toBeNull();
    expect(await reader.read('   ')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('GeminiReader: the answer becomes a Proposal', () => {
  const read = async (model: unknown, text = MESSAGE) => {
    const { fetch } = fakeFetch(() => geminiSays(model));
    return new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(text);
  };

  it('reads a debt', async () => {
    expect(await read(GOOD_DEBT)).toEqual({
      intent: { kind: 'debt', customer: 'tendai', cents: 2000, item: 'sugar' },
      amountSubstring: '20',
      customerSubstring: 'tendai'
    });
  });

  it('reads a payment', async () => {
    expect(
      await read({ kind: 'payment', amountText: 'R10', amountCents: 1000, customerText: 'Tendai' })
    ).toEqual({
      intent: { kind: 'payment', customer: 'Tendai', cents: 1000 },
      amountSubstring: 'R10',
      customerSubstring: 'Tendai'
    });
  });

  it('reads a sale and an expense, with no customer', async () => {
    expect(await read({ kind: 'sale', amountText: '45', amountCents: 4500, item: 'bread' })).toEqual({
      intent: { kind: 'sale', cents: 4500, item: 'bread' },
      amountSubstring: '45'
    });
    expect(await read({ kind: 'expense', amountText: '120', amountCents: 12000, customerText: '' })).toEqual({
      intent: { kind: 'expense', cents: 12000 },
      amountSubstring: '120'
    });
  });

  it('passes a customer the model gave for a sale on, so the check can refuse it', async () => {
    expect(
      await read({ kind: 'sale', amountText: '45', amountCents: 4500, customerText: 'Tendai' })
    ).toEqual({
      intent: { kind: 'sale', cents: 4500 },
      amountSubstring: '45',
      customerSubstring: 'Tendai'
    });
  });

  it('ignores thought parts and joins the text parts', async () => {
    const { fetch } = fakeFetch(() =>
      answer({
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking about it', thought: true },
                { text: '{"kind":"sale",' },
                { text: '"amountText":"45","amountCents":4500}' }
              ]
            }
          }
        ]
      })
    );
    const proposal = await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read('bread 45');
    expect(proposal?.intent).toEqual({ kind: 'sale', cents: 4500 });
  });

  it('returns null for kind none and for any kind outside the four', async () => {
    for (const kind of ['none', 'undo', 'today', 'close', 'unknown', 'refund', 7, null]) {
      expect(await read({ kind, amountText: '20', amountCents: 2000, customerText: 'tendai' }), String(kind)).toBeNull();
    }
  });

  it('returns null when the answer is missing a field or has the wrong type', async () => {
    const bad: unknown[] = [
      {},
      { kind: 'sale' },
      { kind: 'sale', amountText: '45' },
      { kind: 'sale', amountCents: 4500 },
      { kind: 'sale', amountText: '', amountCents: 4500 },
      { kind: 'sale', amountText: '45', amountCents: '4500' },
      { kind: 'sale', amountText: '45', amountCents: 45.5 },
      { kind: 'sale', amountText: '45', amountCents: 2 ** 60 },
      { kind: 'sale', amountText: 45, amountCents: 4500 },
      { kind: 'debt', amountText: '20', amountCents: 2000 },
      { kind: 'payment', amountText: '20', amountCents: 2000, customerText: '  ' },
      [],
      'sale',
      42,
      null
    ];
    for (const model of bad) {
      expect(await read(model), JSON.stringify(model)).toBeNull();
    }
  });

  it('returns null when the model text is not JSON', async () => {
    expect(await read('I think this is a sale of R45')).toBeNull();
    expect(await read('{"kind": "sale", ')).toBeNull();
    expect(await read('')).toBeNull();
  });

  it('returns null when Gemini sends no usable candidate', async () => {
    const bodies: unknown[] = [
      {},
      null,
      'text',
      { candidates: [] },
      { candidates: [{}] },
      { candidates: [{ content: {} }] },
      { candidates: [{ content: { parts: [] } }] },
      { candidates: [{ content: { parts: [{ inlineData: {} }] } }] },
      { promptFeedback: { blockReason: 'SAFETY' } }
    ];
    for (const body of bodies) {
      const { fetch } = fakeFetch(() => answer(body));
      expect(await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(MESSAGE), JSON.stringify(body)).toBeNull();
    }
  });
});

describe('GeminiReader: failures give null and never throw', () => {
  it('returns null for every answer that is not 200', async () => {
    for (const status of [201, 204, 301, 400, 401, 403, 404, 429, 500, 503]) {
      const { fetch, calls } = fakeFetch(() =>
        answer({ candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD_DEBT) }] } }] }, status)
      );
      expect(await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(MESSAGE), String(status)).toBeNull();
      expect(calls).toHaveLength(1); // no retry
    }
  });

  it('returns null when the network fails', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(MESSAGE)).toBeNull();

    const rejecting = fakeFetch(() => Promise.reject(new Error('socket hang up')));
    expect(await new GeminiReader({ apiKey: FAKE_KEY, fetch: rejecting.fetch }).read(MESSAGE)).toBeNull();
  });

  it('returns null when the body cannot be read as JSON', async () => {
    const { fetch } = fakeFetch(() => ({
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      }
    }));
    expect(await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(MESSAGE)).toBeNull();
  });

  it('returns null on a timeout, and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    const { fetch } = fakeFetch(
      (call) =>
        new Promise<FetchResponseLike>((_resolve, reject) => {
          signal = call.init.signal;
          call.init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    const reader = new GeminiReader({ apiKey: FAKE_KEY, timeoutMs: 20, fetch });
    expect(await reader.read(MESSAGE)).toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('returns null on a timeout even when fetch ignores the abort signal', async () => {
    const { fetch } = fakeFetch(() => new Promise<FetchResponseLike>(() => {}));
    const reader = new GeminiReader({ apiKey: FAKE_KEY, timeoutMs: 20, fetch });
    expect(await reader.read(MESSAGE)).toBeNull();
  });

  it('returns null on a timeout while the body is still being read', async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, json: () => new Promise<unknown>(() => {}) }));
    const reader = new GeminiReader({ apiKey: FAKE_KEY, timeoutMs: 20, fetch });
    expect(await reader.read(MESSAGE)).toBeNull();
  });

  it('waits 4000 ms by default, no more and no less', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch(() => new Promise<FetchResponseLike>(() => {}));
    const reader = new GeminiReader({ apiKey: FAKE_KEY, fetch });

    let settled: unknown = 'pending';
    void reader.read(MESSAGE).then((value) => {
      settled = value;
    });

    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
  });

  it('does not wait for the timer once the answer has come', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch(() => geminiSays(GOOD_DEBT));
    const reader = new GeminiReader({ apiKey: FAKE_KEY, fetch });
    const proposal = await reader.read(MESSAGE);
    expect(proposal).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave an unhandled rejection when the call fails after the timeout', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { fetch } = fakeFetch(
        () =>
          new Promise<FetchResponseLike>((_resolve, reject) => {
            setTimeout(() => reject(new Error('late failure')), 60);
          })
      );
      const reader = new GeminiReader({ apiKey: FAKE_KEY, timeoutMs: 10, fetch });
      expect(await reader.read(MESSAGE)).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('asks once per message, and a second message is a second call', async () => {
    const { fetch, calls } = fakeFetch(() => geminiSays(GOOD_DEBT));
    const reader = new GeminiReader({ apiKey: FAKE_KEY, fetch });
    await reader.read(MESSAGE);
    expect(calls).toHaveLength(1);
    await reader.read(MESSAGE);
    expect(calls).toHaveLength(2);
  });

  it('ignores a timeoutMs that is not a positive number and uses the default', async () => {
    vi.useFakeTimers();
    for (const timeoutMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { fetch } = fakeFetch(() => new Promise<FetchResponseLike>(() => {}));
      const reader = new GeminiReader({ apiKey: FAKE_KEY, timeoutMs, fetch });
      let settled: unknown = 'pending';
      void reader.read(MESSAGE).then((value) => {
        settled = value;
      });
      await vi.advanceTimersByTimeAsync(3999);
      expect(settled, String(timeoutMs)).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(settled, String(timeoutMs)).toBeNull();
    }
  });
});

describe('GeminiReader: the key and the message are never logged or returned', () => {
  it('writes nothing to the console on success or on any failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );

    const responders: Array<() => Promise<FetchResponseLike> | FetchResponseLike> = [
      () => geminiSays(GOOD_DEBT),
      () => answer({}, 500),
      () => geminiSays('not json'),
      () => {
        throw new Error(`boom ${FAKE_KEY} ${MESSAGE}`);
      },
      () => new Promise<FetchResponseLike>(() => {})
    ];
    for (const respond of responders) {
      await new GeminiReader({ apiKey: FAKE_KEY, timeoutMs: 20, fetch: fakeFetch(respond).fetch }).read(MESSAGE);
    }

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('does not put the key in the proposal it returns', async () => {
    const { fetch } = fakeFetch(() => geminiSays(GOOD_DEBT));
    const proposal = await new GeminiReader({ apiKey: FAKE_KEY, fetch }).read(MESSAGE);
    expect(JSON.stringify(proposal)).not.toContain(FAKE_KEY);
  });

  it('does not reveal the key when it is stringified or logged by someone else', async () => {
    const reader = new GeminiReader({ apiKey: FAKE_KEY });
    // A reader that is printed by mistake (console.log(reader), JSON.stringify(reader)) must not show the key.
    expect(JSON.stringify(reader)).not.toContain(FAKE_KEY);
    expect(inspect(reader, { depth: 5, showHidden: true })).not.toContain(FAKE_KEY);
    expect(Object.getOwnPropertyNames(reader).join(',')).not.toMatch(/key/i);
  });
});
