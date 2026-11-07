import { describe, expect, it } from 'vitest';
import {
  COMPOSE_MAX,
  DIAL_MAX,
  ENTRY_MAX,
  LEDGER_CODE,
  buildUssdText,
  classifyDial,
  createPhone,
  parseSmsReply,
  parseUssdReply,
  reduce,
  trimEntry,
} from '../../../public/phone-logic.js';

describe('classifyDial', () => {
  it('knows the ledger code', () => {
    expect(LEDGER_CODE).toBe('*384*46254#');
    expect(classifyDial('*384*46254#')).toBe('ledger');
  });

  it('calls near misses unknown', () => {
    for (const text of ['*384*46254', '*384#', '*384*46255#', '384*46254#', '*384*46254#*', ' *384*46254#', '1', '#']) {
      expect(classifyDial(text)).toBe('unknown');
    }
  });

  it('calls nothing empty', () => {
    expect(classifyDial('')).toBe('empty');
  });
});

describe('buildUssdText', () => {
  it('joins the path and the entry with *', () => {
    expect(buildUssdText([], '1')).toBe('1');
    expect(buildUssdText(['1'], '45')).toBe('1*45');
    expect(buildUssdText(['1', '45'], '1')).toBe('1*45*1');
  });

  it('sends 0 and 00 as typed, as ordinary entries', () => {
    expect(buildUssdText(['1', '45'], '0')).toBe('1*45*0');
    expect(buildUssdText(['1', '45', '0'], '00')).toBe('1*45*0*00');
    expect(buildUssdText(['1', '45', '0', '00'], '3')).toBe('1*45*0*00*3');
  });

  it('leaves a 0 inside a longer entry alone', () => {
    expect(buildUssdText(['1'], '100')).toBe('1*100');
    expect(buildUssdText(['1'], '20')).toBe('1*20');
    expect(buildUssdText(['1'], '1000.50')).toBe('1*1000.50');
  });

  it('does not change the path it is given', () => {
    const path = ['1', '45'];
    buildUssdText(path, '0');
    expect(path).toEqual(['1', '45']);
  });
});

describe('trimEntry and limits', () => {
  it('trims the ends and returns an empty text for a blank entry', () => {
    expect(trimEntry(' 45 ')).toBe('45');
    expect(trimEntry('  ')).toBe('');
  });

  it('has the limits from the brief', () => {
    expect(DIAL_MAX).toBe(20);
    expect(ENTRY_MAX).toBe(40);
    expect(COMPOSE_MAX).toBe(160);
  });
});

describe('0, 00, * and # through the state machine', () => {
  function sessionAt(path: string[]) {
    // Build a session by replaying replies, so the path is what the reducer made.
    let state = reduce(createPhone(), { type: 'shop', phone: '+27000001234' }).state;
    for (const key of LEDGER_CODE) state = reduce(state, { type: 'press', key }).state;
    state = reduce(state, { type: 'send', sessionId: 's1', messageId: 1 }).state;
    state = reduce(state, { type: 'ussdReply', sessionId: 's1', reply: { ok: true, kind: 'CON', lines: ['Menu'], chars: 4, limit: 182 } }).state;
    for (const entry of path) {
      for (const ch of entry) state = reduce(state, { type: 'press', key: ch }).state;
      const sent = reduce(state, { type: 'send', sessionId: 'unused', messageId: 1 });
      state = sent.state;
      state = reduce(state, { type: 'ussdReply', sessionId: 's1', reply: { ok: true, kind: 'CON', lines: ['Next'], chars: 4, limit: 182 } }).state;
    }
    return state;
  }

  function sendEntry(state: any, entry: string) {
    let s = state;
    for (const ch of entry) s = reduce(s, { type: 'press', key: ch }).state;
    return reduce(s, { type: 'send', sessionId: 'unused', messageId: 1 });
  }

  it('sends 1, 45, 1 as 1*45*1', () => {
    const state = sessionAt(['1', '45']);
    const result = sendEntry(state, '1');
    expect(result.effects).toEqual([{ type: 'ussd', body: { phone: '+27000001234', sessionId: 's1', text: '1*45*1' } }]);
  });

  it('sends 0 as an entry and keeps it in the path', () => {
    const afterZero = sendEntry(sessionAt(['1', '45']), '0');
    expect(afterZero.effects[0].body.text).toBe('1*45*0');
    const replied = reduce(afterZero.state, { type: 'ussdReply', sessionId: 's1', reply: { ok: true, kind: 'CON', lines: ['Back'], chars: 4, limit: 182 } }).state;
    expect(replied.session.path).toEqual(['1', '45', '0']);
    const next = sendEntry(replied, '00');
    expect(next.effects[0].body.text).toBe('1*45*0*00');
    const replied2 = reduce(next.state, { type: 'ussdReply', sessionId: 's1', reply: { ok: true, kind: 'CON', lines: ['Main'], chars: 4, limit: 182 } }).state;
    expect(replied2.session.path).toEqual(['1', '45', '0', '00']);
  });

  it('never clears or trims the path by itself', () => {
    let state = sessionAt(['1', '45']);
    for (const entry of ['0', '00', '0']) {
      const sent = sendEntry(state, entry);
      state = reduce(sent.state, { type: 'ussdReply', sessionId: 's1', reply: { ok: true, kind: 'CON', lines: ['x'], chars: 1, limit: 182 } }).state;
    }
    expect(state.session.path).toEqual(['1', '45', '0', '00', '0']);
  });

  it('treats 100 as one entry', () => {
    const result = sendEntry(sessionAt(['1']), '100');
    expect(result.effects[0].body.text).toBe('1*100');
  });

  it('refuses * and # in an entry', () => {
    const state = sessionAt(['1']);
    for (const event of [
      { type: 'press', key: '*' },
      { type: 'press', key: '#' },
      { type: 'char', ch: '*' },
      { type: 'char', ch: '#' },
    ]) {
      const result = reduce(state, event);
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    }
  });

  it('accepts at most 40 characters in an entry', () => {
    let state = sessionAt(['1']);
    for (let i = 0; i < 60; i += 1) state = reduce(state, { type: 'press', key: '7' }).state;
    expect(state.editor.text).toHaveLength(40);
    const sent = reduce(state, { type: 'send', sessionId: 'unused', messageId: 1 });
    expect(sent.effects[0].body.text).toBe(`1*${'7'.repeat(40)}`);
  });

  it('ignores a send when the entry is empty or only spaces', () => {
    const state = sessionAt(['1']);
    const empty = reduce(state, { type: 'send', sessionId: 'unused', messageId: 1 });
    expect(empty.state).toBe(state);
    expect(empty.effects).toEqual([]);
    const spaced = reduce(state, { type: 'char', ch: ' ' }).state;
    const again = reduce(spaced, { type: 'send', sessionId: 'unused', messageId: 1 });
    expect(again.effects).toEqual([]);
  });

  it('accepts at most 20 characters on the dial line and ignores letters', () => {
    let state = reduce(createPhone(), { type: 'shop', phone: '+27000001234' }).state;
    for (let i = 0; i < 30; i += 1) state = reduce(state, { type: 'press', key: '5' }).state;
    expect(state.editor.text).toHaveLength(20);
    const letters = reduce(state, { type: 'char', ch: 'a' });
    expect(letters.state).toBe(state);
  });
});

describe('parseUssdReply', () => {
  it('reads a CON screen and keeps its lines unchanged', () => {
    const reply = parseUssdReply({ response: 'CON Mama Thandi\nToday: sales R1,240\n1 Sale\n9 More', length: 40, limit: 182 });
    expect(reply).toEqual({
      ok: true,
      kind: 'CON',
      lines: ['Mama Thandi', 'Today: sales R1,240', '1 Sale', '9 More'],
      chars: 40,
      limit: 182,
    });
  });

  it('reads an END screen', () => {
    const reply = parseUssdReply({ response: 'END Saved: sale R45 bread. Sales today R1,285.', length: 44, limit: 182 });
    expect(reply).toMatchObject({ ok: true, kind: 'END', lines: ['Saved: sale R45 bread. Sales today R1,285.'] });
  });

  it('does not trim spaces or drop empty lines', () => {
    const reply = parseUssdReply({ response: 'CON  indented\n\n  last ', length: 1, limit: 182 });
    expect(reply).toMatchObject({ ok: true, lines: [' indented', '', '  last '] });
  });

  it('turns chars and limit that are not safe integers into null', () => {
    for (const [chars, limit] of [
      ['40', 182],
      [40.5, 182],
      [-1, 182],
      [40, undefined],
      [Number.NaN, 182],
      [Number.MAX_SAFE_INTEGER + 2, 182],
    ] as const) {
      const reply = parseUssdReply({ response: 'CON hi', length: chars, limit });
      expect(reply.ok).toBe(true);
      if (reply.ok) expect(reply.chars === null || reply.limit === null).toBe(true);
    }
    expect(parseUssdReply({ response: 'CON hi' })).toMatchObject({ ok: true, chars: null, limit: null });
  });

  it('reads the count from `length`, the name the route uses, and ignores a field called `chars`', () => {
    expect(parseUssdReply({ response: 'CON hi', length: 2, limit: 182 })).toMatchObject({ chars: 2, limit: 182 });
    expect(parseUssdReply({ response: 'CON hi', chars: 2, limit: 182 })).toMatchObject({ chars: null, limit: 182 });
  });

  it('fails for a bad prefix or a missing response', () => {
    for (const bad of [
      { response: 'Hello' },
      { response: 'CON' },
      { response: 'con hi' },
      { response: ' CON hi' },
      { response: 'END' },
      { response: 5 },
      { response: null },
      { reply: 'CON hi' },
      {},
      null,
      undefined,
      'CON hi',
      [],
    ]) {
      expect(parseUssdReply(bad)).toEqual({ ok: false });
    }
  });
});

describe('parseSmsReply', () => {
  it('reads a reply', () => {
    expect(parseSmsReply({ reply: 'Saved: sale R45.', length: 16, limit: 160 })).toEqual({
      ok: true,
      text: 'Saved: sale R45.',
      chars: 16,
      limit: 160,
    });
  });

  it('reads the count from `length` and ignores a field called `chars`', () => {
    expect(parseSmsReply({ reply: 'Hi', chars: 2, limit: 160 })).toMatchObject({ chars: null, limit: 160 });
  });

  it('keeps going without counts', () => {
    expect(parseSmsReply({ reply: 'Hi' })).toEqual({ ok: true, text: 'Hi', chars: null, limit: null });
  });

  it('fails without a string reply', () => {
    for (const bad of [{}, { reply: 5 }, { reply: '' }, { reply: '   ' }, { response: 'CON hi' }, null, undefined, 'Hi']) {
      expect(parseSmsReply(bad)).toEqual({ ok: false });
    }
  });
});
