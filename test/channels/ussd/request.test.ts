import { describe, it, expect } from 'vitest';
import { readRequest, MAX_INPUTS, MAX_TEXT_LENGTH } from '../../../src/channels/ussd/request.js';

const base = { sessionId: 'ATUid_abc-1.2', phoneNumber: '+27 00 000 1234', text: '' };

function inputsOf(text: string): string[] | null {
  const r = readRequest({ ...base, text });
  return r.ok ? r.request.inputs : null;
}

describe('readRequest', () => {
  it('reads an empty text as no inputs', () => {
    expect(inputsOf('')).toEqual([]);
  });

  it('splits "1*45*1" into three inputs', () => {
    expect(inputsOf('1*45*1')).toEqual(['1', '45', '1']);
  });

  it('keeps an empty segment as an empty input', () => {
    expect(inputsOf('1**2')).toEqual(['1', '', '2']);
    expect(inputsOf('*')).toEqual(['', '']);
    expect(inputsOf('1*')).toEqual(['1', '']);
  });

  it('keeps spaces inside the inputs for later steps to handle', () => {
    expect(inputsOf(' 1 *R 1 200')).toEqual([' 1 ', 'R 1 200']);
  });

  it('normalises the phone number and keeps the session id', () => {
    const r = readRequest(base);
    expect(r).toEqual({
      ok: true,
      request: { sessionId: 'ATUid_abc-1.2', phone: '+27000001234', inputs: [] }
    });
  });

  it('accepts a session id of 1 and of 100 characters', () => {
    expect(readRequest({ ...base, sessionId: 'a' }).ok).toBe(true);
    expect(readRequest({ ...base, sessionId: 'a'.repeat(100) }).ok).toBe(true);
  });

  it('refuses an empty session id, 101 characters, and a character that is not allowed', () => {
    expect(readRequest({ ...base, sessionId: '' }).ok).toBe(false);
    expect(readRequest({ ...base, sessionId: 'a'.repeat(101) }).ok).toBe(false);
    expect(readRequest({ ...base, sessionId: 'has space' }).ok).toBe(false);
    expect(readRequest({ ...base, sessionId: 'a*b' }).ok).toBe(false);
    expect(readRequest({ ...base, sessionId: 'a/b' }).ok).toBe(false);
    expect(readRequest({ ...base, sessionId: 'caf\u00e9' }).ok).toBe(false);
    expect(readRequest({ ...base, sessionId: 'a\nb' }).ok).toBe(false);
  });

  it('refuses a phone number that cannot be normalised', () => {
    expect(readRequest({ ...base, phoneNumber: '' }).ok).toBe(false);
    expect(readRequest({ ...base, phoneNumber: 'abc' }).ok).toBe(false);
    expect(readRequest({ ...base, phoneNumber: '0000' }).ok).toBe(false);
  });

  it('accepts a text of 500 characters and refuses 501', () => {
    expect(MAX_TEXT_LENGTH).toBe(500);
    expect(readRequest({ ...base, text: '1'.repeat(500) }).ok).toBe(true);
    expect(readRequest({ ...base, text: '1'.repeat(501) }).ok).toBe(false);
  });

  it('accepts 30 inputs and refuses 31', () => {
    expect(MAX_INPUTS).toBe(30);
    expect(readRequest({ ...base, text: Array(30).fill('1').join('*') }).ok).toBe(true);
    expect(readRequest({ ...base, text: Array(31).fill('1').join('*') }).ok).toBe(false);
  });

  it('refuses a field that is not a string', () => {
    expect(readRequest({ ...base, text: undefined as unknown as string }).ok).toBe(false);
    expect(readRequest({ ...base, sessionId: 5 as unknown as string }).ok).toBe(false);
    expect(readRequest({ ...base, phoneNumber: null as unknown as string }).ok).toBe(false);
  });
});
