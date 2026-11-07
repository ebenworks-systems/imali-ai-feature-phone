import { afterEach, describe, expect, it, vi } from 'vitest';
import { SENTENCES } from '../../src/server/constants.js';
import { logError, ownerSentence } from '../../src/server/errors.js';
import { RecordLimitError } from '../../src/store/limit.js';

describe('ownerSentence', () => {
  it('gives the full-book sentence for RecordLimitError', () => {
    expect(ownerSentence(new RecordLimitError('shop1', 2000))).toBe(SENTENCES.full);
  });

  it('gives the generic sentence for anything else, and never the error message', () => {
    for (const error of [new Error('connection to db.internal:5432 failed'), 'boom', null, undefined, { name: 'X' }]) {
      expect(ownerSentence(error)).toBe(SENTENCES.generic);
    }
  });
});

describe('logError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes one JSON line with route, name, message, stack and a masked phone', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('database said no');
    logError('/sms', error, '+27000001234');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line.includes('\n')).toBe(false);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: 'error', route: '/sms', name: 'Error', message: 'database said no' });
    expect(parsed.stack).toContain('database said no');
    expect(parsed.phone).toBe('+270***34');
  });

  it('has no full phone number in the line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('/ussd', new Error('x'), '+27000001234');
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('+27000001234');
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('000001234');
  });

  it('leaves out the phone when there is none, and copes with a thrown string', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('/api/phone/demo', 'plain string');
    const parsed = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(parsed.message).toBe('plain string');
    expect('phone' in parsed).toBe(false);
  });
});
