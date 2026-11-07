import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
const end = vi.fn(async () => {});

// No connection is made: the driver is replaced by a function that records its arguments.
vi.mock('postgres', () => ({
  default: (url: string, options: Record<string, unknown>) => {
    calls.push({ url, options });
    return { end };
  }
}));

import { closePostgres, connectPostgres } from '../../../src/store/postgres/client.js';

describe('connectPostgres', () => {
  beforeEach(() => {
    calls.length = 0;
    end.mockClear();
  });

  it('passes the url and the pool options', () => {
    connectPostgres('postgres-test-url-not-real');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('postgres-test-url-not-real');
    expect(calls[0]?.options).toMatchObject({
      max: 3,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20
    });
  });

  it('drops server notices', () => {
    connectPostgres('x');
    const onnotice = calls[0]?.options.onnotice as () => void;
    expect(typeof onnotice).toBe('function');
    expect(onnotice()).toBeUndefined();
  });

  it('closes with a 5 second wait', async () => {
    const sql = connectPostgres('x');
    await closePostgres(sql);
    expect(end).toHaveBeenCalledWith({ timeout: 5 });
  });
});
