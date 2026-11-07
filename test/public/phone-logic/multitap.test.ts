import { describe, expect, it } from 'vitest';
import {
  CYCLES,
  COMPOSE_MAX,
  DIAL_MAX,
  ENTRY_MAX,
  MULTITAP_MS,
  PAD,
  acceptPending,
  backspace,
  createEditor,
  isEmpty,
  setText,
  settle,
  tap,
  toggleMode,
  trimEntry,
  typeChar,
  view,
} from '../../../public/phone-logic.js';

const compose = (mode: '123' | 'abc' = 'abc') => createEditor({ allow: 'text', mode, max: COMPOSE_MAX });

/** Tap keys one after another, `gap` ms apart, starting at `start`. */
function tapAll(editor: any, keys: string, start = 1000, gap = 100) {
  let t = start;
  let e = editor;
  for (const key of keys) {
    e = tap(e, key, t);
    t += gap;
  }
  return e;
}

describe('the pad', () => {
  it('has 12 keys with the letters under the digits', () => {
    expect(PAD.map((p) => p.key)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']);
    expect(PAD.find((p) => p.key === '2')?.letters).toBe('abc');
    expect(PAD.find((p) => p.key === '7')?.letters).toBe('pqrs');
    expect(PAD.find((p) => p.key === '9')?.letters).toBe('wxyz');
    expect(PAD.filter((p) => p.letters === '').map((p) => p.key)).toEqual(['1', '*', '0', '#']);
  });

  it('cycles end with the digit, and 0 and 1 follow the brief', () => {
    expect(CYCLES[2]).toBe('abc2');
    expect(CYCLES[0]).toBe(' 0');
    expect(CYCLES[1]).toBe(".,?!'@1");
  });
});

describe('123 mode', () => {
  it('adds the digit', () => {
    let e = compose('123');
    e = tap(e, '4', 0);
    e = tap(e, '5', 10);
    expect(view(e)).toEqual({ text: '45', pendingIndex: null, mode: '123' });
  });

  it('adds * and # where the editor allows them', () => {
    let e = createEditor({ allow: 'dial', max: DIAL_MAX });
    for (const k of '*384*46254#') e = tap(e, k, 0);
    expect(e.text).toBe('*384*46254#');
  });

  it('refuses * and # in a menu entry', () => {
    let e = createEditor({ allow: 'entry', max: ENTRY_MAX });
    e = tap(e, '4', 0);
    expect(tap(e, '*', 5)).toBe(e);
    expect(tap(e, '#', 5)).toBe(e);
    expect(typeChar(e, '*')).toBe(e);
    expect(typeChar(e, '#')).toBe(e);
  });

  it('stops at max', () => {
    let e = createEditor({ allow: 'dial', max: 3 });
    e = tapAll(e, '12345');
    expect(e.text).toBe('123');
  });

  it('ignores a key that is not on the pad', () => {
    const e = compose('123');
    expect(tap(e, 'a', 0)).toBe(e);
    expect(tap(e, '12', 0)).toBe(e);
    expect(tap(e, '', 0)).toBe(e);
  });
});

describe('multi-tap cycles', () => {
  // Start from 'x' so the capital rule stays out of the way.
  const withX = () => setText(compose('abc'), 'x');

  for (const [key, cycle] of Object.entries(CYCLES)) {
    it(`key ${key} walks through "${cycle}" and wraps`, () => {
      let e = withX();
      for (let n = 0; n < cycle.length * 2 + 1; n += 1) {
        e = tap(e, key, 1000 + n * 100);
        expect(view(e).text).toBe(`x${cycle[n % cycle.length]}`);
        expect(view(e).pendingIndex).toBe(1);
      }
    });
  }

  it('shows the pending character as pending until it is accepted', () => {
    const e = tap(withX(), '2', 0);
    expect(e.text).toBe('x');
    expect(view(e).pendingIndex).toBe(1);
    expect(acceptPending(e).text).toBe('xa');
    expect(view(acceptPending(e)).pendingIndex).toBeNull();
  });

  it('joins a tap 899 ms after the last one', () => {
    let e = withX();
    e = tap(e, '2', 1000);
    e = tap(e, '2', 1899);
    expect(view(e).text).toBe('xb');
  });

  it('starts a new character 900 ms after the last tap', () => {
    let e = withX();
    e = tap(e, '2', 1000);
    e = tap(e, '2', 1900);
    expect(view(e).text).toBe('xaa');
    expect(e.text).toBe('xa');
  });

  it('measures 900 ms from the last tap, not the first', () => {
    let e = withX();
    e = tap(e, '2', 1000);
    e = tap(e, '2', 1800);
    e = tap(e, '2', 2600);
    expect(view(e).text).toBe('xc');
  });

  it('accepts the pending character when another key is tapped', () => {
    let e = withX();
    e = tap(e, '2', 1000);
    e = tap(e, '3', 1100);
    expect(e.text).toBe('xa');
    expect(view(e).text).toBe('xad');
  });

  it('accepts the pending character on * and #, then adds them', () => {
    let e = tap(withX(), '2', 1000);
    e = tap(e, '*', 1100);
    expect(e.text).toBe('xa*');
    expect(e.pending).toBeNull();
    e = tap(e, '#', 1200);
    expect(e.text).toBe('xa*#');
  });

  it('settles a pending character only after 900 ms', () => {
    const e = tap(withX(), '2', 1000);
    expect(settle(e, 1899)).toBe(e);
    const settled = settle(e, 1900);
    expect(settled.text).toBe('xa');
    expect(settled.pending).toBeNull();
    expect(settle(settled, 5000)).toBe(settled);
  });

  it('does not join two taps more than 900 ms apart even when the timer fires late', () => {
    let e = tap(withX(), '2', 1000);
    // the settle timer never ran
    e = tap(e, '2', 5000);
    expect(e.text).toBe('xa');
    expect(view(e).text).toBe('xaa');
  });

  it('types a space and then a zero from key 0', () => {
    let e = withX();
    e = tap(e, '0', 1000);
    expect(view(e).text).toBe('x ');
    e = tap(e, '0', 1100);
    expect(view(e).text).toBe('x0');
    e = tap(e, '0', 1200);
    expect(view(e).text).toBe('x ');
  });

  it('types punctuation from key 1', () => {
    let e = withX();
    const seen: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      e = tap(e, '1', 1000 + i * 100);
      seen.push(view(e).text.slice(1));
    }
    expect(seen).toEqual(['.', ',', '?', '!', "'", '@', '1']);
  });

  it('never offers * or # from a letter key in a menu entry', () => {
    const entry = createEditor({ allow: 'entry', mode: 'abc', max: ENTRY_MAX });
    for (const key of '0123456789') {
      let e = setText(entry, 'x');
      for (let i = 0; i < 8; i += 1) {
        e = tap(e, key, 1000 + i * 100);
        expect(view(e).text).not.toMatch(/[*#]/);
      }
    }
  });
});

describe('capital letter at the start', () => {
  it('types a capital while the entry is empty', () => {
    const e = tap(compose(), '2', 1000);
    expect(view(e).text).toBe('A');
    expect(view(tap(e, '2', 1100)).text).toBe('B');
    expect(view(tap(tap(e, '2', 1100), '2', 1200)).text).toBe('C');
  });

  it('keeps the digit and punctuation as they are', () => {
    let e = compose();
    for (let i = 0; i < 4; i += 1) e = tap(e, '2', 1000 + i * 100);
    expect(view(e).text).toBe('2');
    expect(view(tap(compose(), '1', 0)).text).toBe('.');
  });

  it('types lower case after the first character', () => {
    let e = tap(compose(), '2', 1000);
    e = tap(e, '3', 1100);
    expect(view(e).text).toBe('Ad');
  });

  it('types a capital again after the entry is cleared', () => {
    let e = tapAll(compose(), '23');
    e = settle(e, 99999);
    expect(e.text).toBe('Ad');
    e = backspace(backspace(e));
    expect(e.text).toBe('');
    expect(view(tap(e, '2', 100000)).text).toBe('A');
  });

  it('types Tendai with the pad', () => {
    // T=8, e=3 3, n=6 6, d=3, a=2, i=4 4 4
    const taps: Array<[string, number]> = [
      ['8', 0],
      ['3', 100],
      ['3', 200],
      ['6', 300],
      ['6', 400],
      ['3', 500],
      ['2', 600],
      ['4', 700],
      ['4', 800],
      ['4', 900],
    ];
    let e = compose();
    for (const [key, at] of taps) e = tap(e, key, 1000 + at);
    expect(view(e).text).toBe('Tendai');
    expect(view(e).pendingIndex).toBe(5);
    expect(settle(e, 5000).text).toBe('Tendai');
  });

  it('types a capital in a menu entry too', () => {
    const e = tap(createEditor({ allow: 'entry', mode: 'abc', max: ENTRY_MAX }), '7', 0);
    expect(view(e).text).toBe('P');
  });
});

describe('mode key', () => {
  it('flips between 123 and abc', () => {
    let e = compose('123');
    e = toggleMode(e);
    expect(e.mode).toBe('abc');
    e = toggleMode(e);
    expect(e.mode).toBe('123');
  });

  it('accepts the pending character first', () => {
    let e = tap(compose(), '2', 1000);
    e = toggleMode(e);
    expect(e.text).toBe('A');
    expect(e.pending).toBeNull();
    expect(e.mode).toBe('123');
  });

  it('has no effect on the dial line, which ignores mode', () => {
    const dial = createEditor({ allow: 'dial', mode: 'abc', max: DIAL_MAX });
    expect(dial.mode).toBe('123');
    expect(toggleMode(dial)).toBe(dial);
    expect(view(tap(dial, '2', 0)).text).toBe('2');
  });

  it('starts menu entries in 123 and the compose line in abc when made that way', () => {
    expect(createEditor({ allow: 'entry', max: ENTRY_MAX }).mode).toBe('123');
    expect(compose().mode).toBe('abc');
  });
});

describe('backspace', () => {
  it('removes only the pending character when there is one', () => {
    let e = setText(compose(), 'ab');
    e = tap(e, '3', 1000);
    expect(view(e).text).toBe('abd');
    e = backspace(e);
    expect(view(e).text).toBe('ab');
    expect(e.pending).toBeNull();
  });

  it('removes the last character when none is pending', () => {
    const e = backspace(setText(compose('123'), '4567'));
    expect(e.text).toBe('456');
  });

  it('does nothing on an empty entry', () => {
    const e = compose();
    expect(backspace(e)).toBe(e);
  });
});

describe('max length', () => {
  it('counts the pending character', () => {
    let e = createEditor({ allow: 'text', mode: 'abc', max: 3 });
    e = tapAll(e, '222'); // three quick taps on one key are one pending character
    expect(view(e).text.length).toBe(1);
    e = tapAll(createEditor({ allow: 'text', mode: 'abc', max: 3 }), '234');
    expect(view(e).text).toBe('Adg');
    expect(view(tap(e, '5', 5000)).text).toBe('Adg');
    expect(view(tap(e, '2', 5000)).text).toBe('Adg');
  });

  it('still lets the last pending character cycle when the entry is full', () => {
    let e = createEditor({ allow: 'text', mode: 'abc', max: 2 });
    e = tap(e, '2', 1000);
    e = tap(e, '3', 1100);
    expect(view(e).text).toBe('Ad');
    e = tap(e, '3', 1200);
    expect(view(e).text).toBe('Ae');
  });

  it('stops the computer keyboard at max', () => {
    let e = createEditor({ allow: 'text', max: 4 });
    for (const ch of 'hello') e = typeChar(e, ch);
    expect(e.text).toBe('hell');
  });

  it('keeps the compose line to 160 characters and the entry to 40', () => {
    let c = compose('123');
    for (let i = 0; i < 200; i += 1) c = typeChar(c, 'a');
    expect(c.text).toHaveLength(160);
    let m = createEditor({ allow: 'entry', max: ENTRY_MAX });
    for (let i = 0; i < 60; i += 1) m = typeChar(m, 'a');
    expect(m.text).toHaveLength(40);
    let d = createEditor({ allow: 'dial', max: DIAL_MAX });
    for (let i = 0; i < 30; i += 1) d = tap(d, '1', 0);
    expect(d.text).toHaveLength(20);
  });
});

describe('computer keyboard characters', () => {
  it('accepts the pending character first', () => {
    let e = tap(compose(), '2', 1000);
    e = typeChar(e, 'z');
    expect(e.text).toBe('Az');
  });

  it('drops anything that is not printable ASCII', () => {
    const e = compose('123');
    for (const ch of ['\n', '\t', '\u00e9', '\u2014', '\u{1F600}', 'ab', '', undefined as unknown as string]) {
      expect(typeChar(e, ch)).toBe(e);
    }
  });

  it('keeps the dial line to digits, star and hash', () => {
    const d = createEditor({ allow: 'dial', max: DIAL_MAX });
    expect(typeChar(d, 'a')).toBe(d);
    expect(typeChar(d, ' ')).toBe(d);
    expect(typeChar(d, '*').text).toBe('*');
    expect(typeChar(d, '7').text).toBe('7');
  });
});

describe('helpers', () => {
  it('isEmpty counts a pending character as not empty', () => {
    expect(isEmpty(compose())).toBe(true);
    expect(isEmpty(tap(compose(), '2', 0))).toBe(false);
  });

  it('trims the ends and drops characters that are not printable ASCII', () => {
    expect(trimEntry('  45  ')).toBe('45');
    expect(trimEntry('a\tb\n')).toBe('ab');
    expect(trimEntry('   ')).toBe('');
    expect(trimEntry('caf\u00e9')).toBe('caf');
  });

  it('exports the 900 ms constant', () => {
    expect(MULTITAP_MS).toBe(900);
  });

  it('does not change the editor it is given', () => {
    const e = setText(compose(), 'x');
    const before = JSON.stringify(e);
    tap(e, '2', 0);
    typeChar(e, 'y');
    backspace(e);
    toggleMode(e);
    expect(JSON.stringify(e)).toBe(before);
  });
});
