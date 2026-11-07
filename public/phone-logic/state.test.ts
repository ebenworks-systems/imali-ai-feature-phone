import { describe, expect, it } from 'vitest';
import {
  COPY,
  LEDGER_CODE,
  createPhone,
  reduce,
  screenModel,
} from '../../../public/phone-logic.js';

const PHONE = '+27000001234';
const PHONE_TEXT = '+27 00 000 1234';

type Reply = { ok: true; kind: 'CON' | 'END'; lines: string[]; chars: number | null; limit: number | null };

const con = (lines: string[], chars: number | null = 40, limit: number | null = 182): Reply => ({ ok: true, kind: 'CON', lines, chars, limit });
const end = (lines: string[], chars: number | null = 40, limit: number | null = 182): Reply => ({ ok: true, kind: 'END', lines, chars, limit });
const sms = (text: string, chars: number | null = 98, limit: number | null = 160) => ({ ok: true as const, text, chars, limit });

/** Drives the reducer the way phone.js does and remembers what it asked for. */
class Rig {
  state: any = createPhone();
  effects: any[] = [];
  now = 1000;
  private sessionCount = 0;
  private messageCount = 0;

  event(event: any) {
    const before = this.state;
    const result = reduce(this.state, event, this.now);
    this.state = result.state;
    this.effects = result.effects;
    return { used: result.state !== before, effects: result.effects };
  }
  advance(ms: number) {
    this.now += ms;
  }
  shop(phone: string | null = PHONE) {
    return this.event({ type: 'shop', phone });
  }
  press(keys: string, gap = 100) {
    for (const key of keys) {
      this.event({ type: 'press', key });
      this.advance(gap);
    }
  }
  send() {
    this.sessionCount += 1;
    this.messageCount += 1;
    return this.event({ type: 'send', sessionId: `session-${this.sessionCount}`, messageId: this.messageCount });
  }
  soft(side: 'left' | 'right') {
    return this.event({ type: 'soft', side });
  }
  end() {
    return this.event({ type: 'end' });
  }
  dial() {
    this.press(LEDGER_CODE);
    return this.send();
  }
  ussdReply(reply: any, id = this.state.session?.id) {
    return this.event({ type: 'ussdReply', sessionId: id, reply });
  }
  smsReply(reply: any, id = this.state.sms?.messageId) {
    return this.event({ type: 'smsReply', messageId: id, reply });
  }
  get screen() {
    return screenModel(this.state, { phoneText: PHONE_TEXT });
  }
  get lines() {
    return this.screen.body.map((line: any) => line.text);
  }
}

function rigHome() {
  const rig = new Rig();
  rig.shop();
  return rig;
}

function rigSession() {
  const rig = rigHome();
  rig.dial();
  rig.ussdReply(con(['Mama Thandi', 'Today: sales R0', '1 Sale', '2 Expense']));
  return rig;
}

describe('first visit (no shop)', () => {
  it('shows "Press Start demo shop" and no soft key labels', () => {
    const rig = new Rig();
    expect(rig.lines).toEqual(['Press Start demo shop']);
    expect(rig.screen.softs).toEqual({ left: '', centre: '', right: '' });
    expect(rig.screen.entry).toBeNull();
    expect(rig.screen.counter).toBeNull();
  });

  it('ignores every key', () => {
    const rig = new Rig();
    const before = rig.state;
    for (const event of [
      { type: 'press', key: '1' },
      { type: 'char', ch: 'a' },
      { type: 'backspace' },
      { type: 'mode' },
      { type: 'send', sessionId: 's', messageId: 1 },
      { type: 'soft', side: 'left' },
      { type: 'soft', side: 'right' },
      { type: 'end' },
      { type: 'tick' },
      { type: 'ussdReply', sessionId: 's', reply: con(['x']) },
      { type: 'smsReply', messageId: 1, reply: sms('x') },
    ]) {
      const result = reduce(before, event, 0);
      expect(result.state).toBe(before);
      expect(result.effects).toEqual([]);
    }
  });

  it('does not dial even if the ledger code is somehow in the line', () => {
    const rig = new Rig();
    rig.press(LEDGER_CODE);
    expect(rig.send().effects).toEqual([]);
    expect(rig.state.view).toBe('noShop');
  });
});

describe('the shop event', () => {
  it('shows the home screen with the number, the hint and the soft keys', () => {
    const rig = rigHome();
    expect(rig.state.view).toBe('home');
    expect(rig.lines).toEqual([PHONE_TEXT, 'Dial *384*46254#']);
    expect(rig.screen.softs).toEqual({ left: 'Messages', centre: 'OK', right: 'Menu' });
    expect(rig.screen.entry).toEqual({ prompt: '>', text: '', pendingIndex: null, mode: '123' });
    expect(rig.screen.busy).toBe(false);
    expect(rig.screen.scroll).toBe('top');
  });

  it('goes back to the first-visit state with a null phone', () => {
    const rig = rigHome();
    rig.shop(null);
    expect(rig.state.view).toBe('noShop');
    expect(rig.state.phone).toBeNull();
  });

  it('clears the session, the thread and the counter', () => {
    const rig = rigSession();
    rig.shop('+27000009999');
    expect(rig.state.view).toBe('home');
    expect(rig.state.session).toBeNull();
    expect(rig.state.thread).toEqual([]);
    expect(rig.state.counter).toBeNull();
    expect(rig.state.phone).toBe('+27000009999');
  });

  it('empties the thread on "Start over"', () => {
    const rig = rigHome();
    rig.soft('left');
    rig.event({ type: 'char', ch: 'h' });
    rig.send();
    rig.smsReply(sms('Hi'));
    expect(rig.state.thread.length).toBe(2);
    rig.shop(null);
    rig.shop('+27000005555');
    rig.soft('left');
    expect(rig.state.thread).toEqual([]);
    expect(rig.lines).toEqual(['Text a line like: sold 45 bread']);
  });

  it('drops a menu reply that arrives for the old shop', () => {
    const rig = rigSession();
    rig.press('1');
    rig.send();
    const oldId = rig.state.session.id;
    rig.shop('+27000005555');
    const result = rig.ussdReply(con(['late']), oldId);
    expect(result.used).toBe(false);
    expect(rig.state.view).toBe('home');
  });
});

describe('home: dial, Menu, unknown code', () => {
  it('puts digits, star and hash in the dial line', () => {
    const rig = rigHome();
    rig.press('*384#');
    expect(rig.screen.entry?.text).toBe('*384#');
    expect(rig.screen.softs.right).toBe('Clear');
  });

  it('fills the dial line with the ledger code on the Menu soft key when it is empty', () => {
    const rig = rigHome();
    rig.soft('right');
    expect(rig.screen.entry?.text).toBe(LEDGER_CODE);
    expect(rig.screen.softs.right).toBe('Clear');
  });

  it('clears one character with the Clear soft key and with Backspace', () => {
    const rig = rigHome();
    rig.press('123');
    rig.soft('right');
    expect(rig.screen.entry?.text).toBe('12');
    rig.event({ type: 'backspace' });
    expect(rig.screen.entry?.text).toBe('1');
  });

  it('starts a session on the ledger code: Please wait, empty text, the supplied session id', () => {
    const rig = rigHome();
    rig.press(LEDGER_CODE);
    const result = rig.send();
    expect(result.effects).toEqual([{ type: 'ussd', body: { phone: PHONE, sessionId: 'session-1', text: '' } }]);
    expect(rig.state.view).toBe('session');
    expect(rig.state.session).toMatchObject({ id: 'session-1', path: [], phase: 'loading' });
    expect(rig.lines).toEqual(['Please wait...']);
    expect(rig.screen.busy).toBe(true);
    expect(rig.screen.entry).toBeNull();
    expect(rig.screen.softs).toEqual({ left: 'Cancel', centre: '', right: '' });
  });

  it('starts the same way from the Menu soft key and Send', () => {
    const rig = rigHome();
    rig.soft('right');
    expect(rig.send().effects).toHaveLength(1);
  });

  it('shows "Unknown code. Try *384*46254#." and stays home without a request', () => {
    const rig = rigHome();
    rig.press('*384#');
    const result = rig.send();
    expect(result.effects).toEqual([]);
    expect(rig.state.view).toBe('home');
    expect(rig.lines).toEqual([PHONE_TEXT, 'Dial *384*46254#', 'Unknown code. Try *384*46254#.']);
    expect(rig.screen.entry?.text).toBe('*384#');
  });

  it('removes the unknown-code line when the owner edits the dial line', () => {
    const rig = rigHome();
    rig.press('12');
    rig.send();
    expect(rig.lines).toContain(COPY.unknownCode);
    rig.press('3');
    expect(rig.lines).not.toContain(COPY.unknownCode);
  });

  it('ignores a send on an empty dial line', () => {
    const rig = rigHome();
    const result = rig.send();
    expect(result.used).toBe(false);
    expect(result.effects).toEqual([]);
  });

  it('uses a new session id for every dial', () => {
    const rig = rigHome();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = rig.dial();
      ids.push(result.effects[0].body.sessionId);
      rig.end();
    }
    expect(new Set(ids).size).toBe(3);
  });

  it('refuses a dial without a session id', () => {
    const rig = rigHome();
    rig.press(LEDGER_CODE);
    expect(rig.event({ type: 'send', sessionId: '', messageId: 1 }).effects).toEqual([]);
    expect(rig.state.view).toBe('home');
  });

  it('ignores the mode key on the dial line', () => {
    const rig = rigHome();
    expect(rig.event({ type: 'mode' }).used).toBe(false);
  });

  it('types digits on the dial line even from the computer keyboard, and ignores letters', () => {
    const rig = rigHome();
    rig.event({ type: 'char', ch: '5' });
    expect(rig.event({ type: 'char', ch: 'q' }).used).toBe(false);
    expect(rig.screen.entry?.text).toBe('5');
  });
});

describe('a Sale through the menu', () => {
  it('builds the path 1, 45, 1, 1 and ends with an END screen', () => {
    const rig = rigHome();
    expect(rig.dial().effects[0].body.text).toBe('');

    rig.ussdReply(con(['Mama Thandi', 'Today: sales R0', '1 Sale', '2 Expense'], 55, 182));
    expect(rig.lines).toEqual(['Mama Thandi', 'Today: sales R0', '1 Sale', '2 Expense']);
    expect(rig.screen.softs).toEqual({ left: 'Cancel', centre: 'Send', right: 'Clear' });
    expect(rig.screen.entry).toEqual({ prompt: '>', text: '', pendingIndex: null, mode: '123' });
    expect(rig.screen.counter).toEqual({ text: 'This screen: 55 of 182 characters', level: 'ok' });
    expect(rig.effects).toEqual([{ type: 'refresh' }]);

    rig.press('1');
    expect(rig.send().effects[0].body).toEqual({ phone: PHONE, sessionId: 'session-1', text: '1' });
    expect(rig.screen.counter).toBeNull();
    rig.ussdReply(con(['Sale: amount?']));
    expect(rig.state.session.path).toEqual(['1']);

    rig.press('45');
    expect(rig.send().effects[0].body.text).toBe('1*45');
    rig.ussdReply(con(['Item? 1 to skip']));
    expect(rig.state.session.path).toEqual(['1', '45']);

    rig.press('1');
    expect(rig.send().effects[0].body.text).toBe('1*45*1');
    rig.ussdReply(con(['Save sale R45? 1 Yes  2 No']));

    rig.press('1');
    expect(rig.send().effects[0].body.text).toBe('1*45*1*1');
    const finished = rig.ussdReply(end(['Saved: sale R45. Sales today R45.'], 33, 182));
    expect(finished.effects).toEqual([{ type: 'refresh' }]);
    expect(rig.state.session.phase).toBe('ended');
    expect(rig.state.session.path).toEqual([]);
    expect(rig.lines).toEqual(['Saved: sale R45. Sales today R45.']);
    expect(rig.screen.softs).toEqual({ left: '', centre: 'OK', right: '' });
    expect(rig.screen.entry).toBeNull();
    expect(rig.screen.counter?.text).toBe('This screen: 33 of 182 characters');
  });

  it('does not add the entry to the path until the reply says CON', () => {
    const rig = rigSession();
    rig.press('1');
    rig.send();
    expect(rig.state.session.path).toEqual([]);
    expect(rig.state.session.pendingEntry).toBe('1');
  });

  it('keeps the lines exactly as sent, including 9 More', () => {
    const rig = rigHome();
    rig.dial();
    const lines = ['Who owes', '1 Aaa R50', '2 Bbb R40', '3 Ccc R30', '9 More'];
    rig.ussdReply(con(lines, 176, 182));
    expect(rig.lines).toEqual(lines);
    expect(rig.screen.counter).toEqual({ text: 'This screen: 176 of 182 characters - near the limit', level: 'near' });
  });

  it('keeps blank lines and spaces in a screen', () => {
    const rig = rigHome();
    rig.dial();
    rig.ussdReply(con(['Top', '', '  indented ']));
    expect(rig.lines).toEqual(['Top', '', '  indented ']);
  });

  it('shows no counter when chars or limit are missing', () => {
    const rig = rigHome();
    rig.dial();
    rig.ussdReply(con(['Hi'], null, null));
    expect(rig.screen.counter).toBeNull();
  });

  it('shows the over-the-limit counter when the server sends too much', () => {
    const rig = rigHome();
    rig.dial();
    rig.ussdReply(con(['Hi'], 190, 182));
    expect(rig.screen.counter?.level).toBe('over');
  });

  it('asks for a refresh after every reply', () => {
    const rig = rigSession();
    rig.press('1');
    rig.send();
    expect(rig.ussdReply(con(['x'])).effects).toEqual([{ type: 'refresh' }]);
    rig.press('2');
    rig.send();
    expect(rig.ussdReply(end(['y'])).effects).toEqual([{ type: 'refresh' }]);
  });
});

describe('END screens', () => {
  function ended() {
    const rig = rigSession();
    rig.press('5');
    rig.send();
    rig.ussdReply(end(['Today: sales R45']));
    return rig;
  }

  it('sends any key home and does nothing else with it', () => {
    const keys: any[] = [
      { type: 'press', key: '5' },
      { type: 'press', key: '0' },
      { type: 'char', ch: 'a' },
      { type: 'backspace' },
      { type: 'mode' },
      { type: 'soft', side: 'left' },
      { type: 'soft', side: 'right' },
      { type: 'send', sessionId: 'x', messageId: 9 },
      { type: 'end' },
    ];
    for (const key of keys) {
      const rig = ended();
      const result = rig.event(key);
      expect(rig.state.view).toBe('home');
      expect(rig.state.session).toBeNull();
      expect(rig.state.editor.text).toBe('');
      expect(rig.state.notice).toBeNull();
      expect(rig.screen.counter).toBeNull();
      expect(result.effects).toEqual([]);
    }
  });

  it('flags that any key works on an ended screen', () => {
    expect(ended().screen.anyKey).toBe(true);
    expect(rigSession().screen.anyKey).toBe(false);
  });

  it('does not start a new session when the key that leaves the END screen is the send key', () => {
    const rig = ended();
    const result = rig.send();
    expect(result.effects).toEqual([]);
    expect(rig.state.view).toBe('home');
  });
});

describe('network errors in a session', () => {
  it('shows "No network. Try again." as an ended screen with no counter', () => {
    const rig = rigSession();
    rig.press('1');
    rig.send();
    const result = rig.ussdReply({ ok: false });
    expect(result.effects).toEqual([{ type: 'refresh' }]);
    expect(rig.lines).toEqual(['No network. Try again.']);
    expect(rig.state.session.phase).toBe('ended');
    expect(rig.state.session.path).toEqual([]);
    expect(rig.screen.counter).toBeNull();
    expect(rig.screen.busy).toBe(false);
    rig.press('1');
    expect(rig.state.view).toBe('home');
  });

  it('treats a failure on the very first request the same way', () => {
    const rig = rigHome();
    rig.dial();
    rig.ussdReply({ ok: false });
    expect(rig.lines).toEqual(['No network. Try again.']);
  });
});

describe('a request on its way', () => {
  function loading() {
    const rig = rigSession();
    rig.press('1');
    rig.send();
    return rig;
  }

  it('shows Please wait and marks the LCD busy', () => {
    const rig = loading();
    expect(rig.lines).toEqual(['Please wait...']);
    expect(rig.screen.busy).toBe(true);
  });

  it('ignores every key except the end key and Cancel', () => {
    const rig = loading();
    const before = rig.state;
    for (const event of [
      { type: 'press', key: '2' },
      { type: 'press', key: '*' },
      { type: 'char', ch: 'x' },
      { type: 'backspace' },
      { type: 'mode' },
      { type: 'send', sessionId: 'new', messageId: 5 },
      { type: 'soft', side: 'right' },
      { type: 'tick' },
    ]) {
      const result = reduce(before, event, 5000);
      expect(result.state).toBe(before);
      expect(result.effects).toEqual([]);
    }
  });

  it('does not send a second request', () => {
    const rig = loading();
    expect(rig.send().effects).toEqual([]);
  });

  it('goes home on the end key', () => {
    const rig = loading();
    rig.end();
    expect(rig.state.view).toBe('home');
    expect(rig.state.session).toBeNull();
  });

  it('goes home on the Cancel soft key', () => {
    const rig = loading();
    rig.soft('left');
    expect(rig.state.view).toBe('home');
  });

  it('drops a reply that arrives after the end key', () => {
    const rig = loading();
    const id = rig.state.session.id;
    rig.end();
    const homeState = rig.state;
    const result = rig.ussdReply(con(['late screen']), id);
    expect(result.used).toBe(false);
    expect(rig.state).toBe(homeState);
    expect(result.effects).toEqual([]);
  });

  it('drops a failure that arrives after the end key', () => {
    const rig = loading();
    const id = rig.state.session.id;
    rig.end();
    expect(rig.ussdReply({ ok: false }, id).used).toBe(false);
    expect(rig.lines).not.toContain('No network. Try again.');
  });

  it('drops a reply from an earlier session while a new one is waiting', () => {
    const rig = loading();
    const oldId = rig.state.session.id;
    rig.end();
    rig.dial();
    const newId = rig.state.session.id;
    expect(newId).not.toBe(oldId);
    expect(rig.ussdReply(con(['old screen']), oldId).used).toBe(false);
    expect(rig.state.session.phase).toBe('loading');
    expect(rig.ussdReply(con(['new screen']), newId).used).toBe(true);
    expect(rig.lines).toEqual(['new screen']);
  });

  it('drops a reply when the session is not waiting', () => {
    const rig = rigSession();
    expect(rig.ussdReply(con(['duplicate'])).used).toBe(false);
  });

  it('drops a reply that is for no session', () => {
    const rig = rigHome();
    expect(rig.ussdReply(con(['x']), 'nobody').used).toBe(false);
  });
});

describe('the end key and Cancel from every view', () => {
  it('on home, clears the dial line and the notice', () => {
    const rig = rigHome();
    rig.press('12');
    rig.send();
    expect(rig.state.notice).not.toBeNull();
    rig.end();
    expect(rig.state.view).toBe('home');
    expect(rig.state.editor.text).toBe('');
    expect(rig.state.notice).toBeNull();
  });

  it('on home with nothing to clear, changes nothing', () => {
    const rig = rigHome();
    expect(rig.end().used).toBe(false);
  });

  it('in a session screen, ends the session and shows an empty dial line', () => {
    const rig = rigSession();
    rig.press('12');
    rig.end();
    expect(rig.state.view).toBe('home');
    expect(rig.state.session).toBeNull();
    expect(rig.screen.entry?.text).toBe('');
    expect(rig.screen.counter).toBeNull();
  });

  it('on the Cancel soft key in a session screen, does the same', () => {
    const rig = rigSession();
    rig.soft('left');
    expect(rig.state.view).toBe('home');
    expect(rig.state.session).toBeNull();
  });

  it('in Messages, leaves the screen and keeps the thread', () => {
    const rig = rigHome();
    rig.soft('left');
    rig.event({ type: 'char', ch: 'h' });
    rig.send();
    rig.smsReply(sms('Hello'));
    rig.end();
    expect(rig.state.view).toBe('home');
    expect(rig.state.thread).toHaveLength(2);
    expect(rig.screen.counter).toBeNull();
    expect(rig.screen.entry?.text).toBe('');
  });

  it('clears the counter every time the phone goes home', () => {
    const rig = rigSession();
    expect(rig.screen.counter).not.toBeNull();
    rig.end();
    expect(rig.screen.counter).toBeNull();
  });
});

describe('Messages', () => {
  function messages() {
    const rig = rigHome();
    rig.soft('left');
    return rig;
  }

  it('opens an empty thread with a hint, an abc compose line and Back/Send/Clear', () => {
    const rig = messages();
    expect(rig.state.view).toBe('messages');
    expect(rig.lines).toEqual(['Text a line like: sold 45 bread']);
    expect(rig.screen.body[0].tone).toBe('hint');
    expect(rig.screen.entry).toEqual({ prompt: '>', text: '', pendingIndex: null, mode: 'abc' });
    expect(rig.screen.softs).toEqual({ left: 'Back', centre: 'Send', right: 'Clear' });
    expect(rig.screen.scroll).toBe('bottom');
  });

  it('types a message with the pad in abc mode', () => {
    const rig = messages();
    rig.press('8');
    expect(rig.screen.entry).toMatchObject({ text: 'T', pendingIndex: 0 });
    rig.press('3');
    rig.press('3', 100);
    expect(rig.screen.entry).toMatchObject({ text: 'Te', pendingIndex: 1 });
  });

  it('settles a pending character on tick after 900 ms', () => {
    const rig = messages();
    rig.press('2', 0);
    rig.advance(899);
    expect(rig.event({ type: 'tick' }).used).toBe(false);
    rig.advance(1);
    expect(rig.event({ type: 'tick' }).used).toBe(true);
    expect(rig.screen.entry).toMatchObject({ text: 'A', pendingIndex: null });
  });

  it('adds the owner message at once as sending, empties the line and asks for an sms', () => {
    const rig = messages();
    for (const ch of 'sold 45 bread') rig.event({ type: 'char', ch });
    const result = rig.send();
    expect(result.effects).toEqual([{ type: 'sms', body: { phone: PHONE, text: 'sold 45 bread' }, messageId: 1 }]);
    expect(rig.state.thread).toEqual([{ key: 1, from: 'me', text: 'sold 45 bread', sending: true }]);
    expect(rig.lines).toEqual(['Me: sold 45 bread']);
    expect(rig.screen.body[0].tone).toBe('dim');
    expect(rig.screen.entry?.text).toBe('');
  });

  it('keeps the compose mode after a send', () => {
    const rig = messages();
    rig.event({ type: 'mode' });
    rig.event({ type: 'char', ch: '4' });
    rig.send();
    expect(rig.screen.entry?.mode).toBe('123');
  });

  it('puts the reply in the thread and shows the text counter', () => {
    const rig = messages();
    for (const ch of 'today') rig.event({ type: 'char', ch });
    rig.send();
    const result = rig.smsReply(sms('Sales today R45.', 16, 160));
    expect(result.effects).toEqual([{ type: 'refresh' }]);
    expect(rig.lines).toEqual(['Me: today', 'Imali AI: Sales today R45.']);
    expect(rig.screen.body.map((l: any) => l.tone)).toEqual(['me', 'ledger']);
    expect(rig.screen.counter).toEqual({ text: 'Reply: 16 of 160 characters', level: 'ok' });
    expect(rig.state.sms).toBeNull();
  });

  it('gives each thread line its own key so only the new line animates', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.smsReply(sms('One'));
    const first = rig.screen.body.map((l: any) => l.key);
    rig.event({ type: 'char', ch: 'b' });
    rig.send();
    rig.smsReply(sms('Two'));
    const second = rig.screen.body.map((l: any) => l.key);
    expect(second.slice(0, 2)).toEqual(first);
    expect(new Set(second).size).toBe(4);
  });

  it('does not bump the screen id for a new thread line', () => {
    const rig = messages();
    const id = rig.state.screenId;
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.smsReply(sms('One'));
    expect(rig.state.screenId).toBe(id);
  });

  it('ignores a second send while a reply is on its way', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.event({ type: 'char', ch: 'b' });
    const result = rig.send();
    expect(result.used).toBe(false);
    expect(result.effects).toEqual([]);
    expect(rig.state.thread).toHaveLength(1);
    expect(rig.screen.entry?.text).toBe('b');
  });

  it('ignores a send when the compose line is empty or blank', () => {
    const rig = messages();
    expect(rig.send().used).toBe(false);
    rig.event({ type: 'char', ch: ' ' });
    expect(rig.send().effects).toEqual([]);
  });

  it('accepts at most 160 characters', () => {
    const rig = messages();
    for (let i = 0; i < 200; i += 1) rig.event({ type: 'char', ch: 'a' });
    expect(rig.state.editor.text).toHaveLength(160);
  });

  it('removes the unsent message on failure, adds a system line and puts the text back', () => {
    const rig = messages();
    for (const ch of 'sold 45 bread') rig.event({ type: 'char', ch });
    rig.send();
    const result = rig.smsReply({ ok: false });
    expect(result.effects).toEqual([{ type: 'refresh' }]);
    expect(rig.state.thread).toEqual([{ key: 2, from: 'system', text: 'No network. Try again.', sending: false }]);
    expect(rig.lines).toEqual(['No network. Try again.']);
    expect(rig.screen.entry?.text).toBe('sold 45 bread');
    expect(rig.screen.counter).toBeNull();
    expect(rig.state.sms).toBeNull();
  });

  it('does not put the text back when the owner has typed something new', () => {
    const rig = messages();
    for (const ch of 'first') rig.event({ type: 'char', ch });
    rig.send();
    rig.event({ type: 'char', ch: 'n' });
    rig.smsReply({ ok: false });
    expect(rig.screen.entry?.text).toBe('n');
  });

  it('lets the owner send again after a failure', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.smsReply({ ok: false });
    expect(rig.send().effects).toHaveLength(1);
  });

  it('keeps the thread after Back and shows it again on the next visit', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.smsReply(sms('Hi'));
    rig.soft('left');
    expect(rig.state.view).toBe('home');
    rig.soft('left');
    expect(rig.lines).toEqual(['Me: a', 'Imali AI: Hi']);
  });

  it('lands the reply in the thread after the owner has left Messages', () => {
    const rig = messages();
    for (const ch of 'today') rig.event({ type: 'char', ch });
    rig.send();
    rig.soft('left'); // Back
    expect(rig.state.view).toBe('home');
    const result = rig.smsReply(sms('Sales today R45.'));
    expect(result.effects).toEqual([{ type: 'refresh' }]);
    expect(rig.state.view).toBe('home');
    expect(rig.screen.counter).toBeNull();
    expect(rig.state.thread.map((l: any) => l.text)).toEqual(['today', 'Sales today R45.']);
    expect(rig.state.thread[0].sending).toBe(false);
  });

  it('does not cancel a text already sent when the end key is pressed', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.end();
    expect(rig.state.sms).not.toBeNull();
    rig.smsReply(sms('Hi'));
    expect(rig.state.thread.map((l: any) => l.text)).toEqual(['a', 'Hi']);
  });

  it('does not put the text back after a failure if Messages is closed', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.end();
    rig.smsReply({ ok: false });
    expect(rig.state.view).toBe('home');
    expect(rig.state.editor.text).toBe('');
    expect(rig.state.thread.map((l: any) => l.text)).toEqual(['No network. Try again.']);
  });

  it('still blocks a second send after leaving and coming back while one is on its way', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.end();
    rig.soft('left');
    rig.event({ type: 'char', ch: 'b' });
    expect(rig.send().effects).toEqual([]);
  });

  it('drops a reply with another message id', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    const before = rig.state;
    expect(rig.smsReply(sms('stale'), 99).used).toBe(false);
    expect(rig.state).toBe(before);
  });

  it('drops a reply when nothing is waiting', () => {
    const rig = messages();
    expect(rig.smsReply(sms('x'), 1).used).toBe(false);
  });

  it('shows no counter when the reply has no counts', () => {
    const rig = messages();
    rig.event({ type: 'char', ch: 'a' });
    rig.send();
    rig.smsReply(sms('Hi', null, null));
    expect(rig.screen.counter).toBeNull();
  });

  it('opens Messages with the left soft key only from home', () => {
    const rig = rigSession();
    rig.soft('left');
    expect(rig.state.view).toBe('home');
  });
});

describe('screens the page writes itself', () => {
  const ascii = /^[\x20-\x7E]*$/;

  function check(rig: Rig) {
    const screen = rig.screen;
    const text = screen.body.map((l: any) => l.text).join('\n');
    expect(text).toMatch(/^[\x20-\x7E\n]*$/);
    expect(text.length).toBeLessThanOrEqual(182);
    for (const label of Object.values(screen.softs) as string[]) expect(label).toMatch(ascii);
    if (screen.counter) expect(screen.counter.text).toMatch(ascii);
  }

  it('first visit, home, unknown code, wait, network error and empty thread are ASCII and under 182 characters', () => {
    const rig = new Rig();
    check(rig); // first visit
    rig.shop();
    check(rig); // home
    rig.press('12');
    rig.send();
    check(rig); // unknown code
    rig.end();
    rig.dial();
    check(rig); // please wait
    rig.ussdReply({ ok: false });
    check(rig); // network error
    rig.end();
    rig.soft('left');
    check(rig); // empty thread
  });

  it('holds for the longest realistic demo number and the longest copy', () => {
    for (const text of [
      COPY.firstVisit,
      COPY.dialHint,
      COPY.unknownCode,
      COPY.wait,
      COPY.networkError,
      COPY.emptyThread,
      `${COPY.me}${'x'.repeat(160)}`,
    ]) {
      expect(text).toMatch(ascii);
    }
    for (const text of [COPY.firstVisit, COPY.dialHint, COPY.unknownCode, COPY.wait, COPY.networkError, COPY.emptyThread]) {
      expect(text.length).toBeLessThanOrEqual(182);
    }
  });

  it('uses the exact copy from the spec', () => {
    expect(COPY.firstVisit).toBe('Press Start demo shop');
    expect(COPY.dialHint).toBe('Dial *384*46254#');
    expect(COPY.unknownCode).toBe('Unknown code. Try *384*46254#.');
    expect(COPY.wait).toBe('Please wait...');
    expect(COPY.networkError).toBe('No network. Try again.');
    expect(COPY.emptyThread).toBe('Text a line like: sold 45 bread');
  });
});

describe('the reducer is pure', () => {
  it('does not change the state or the event it is given', () => {
    const rig = rigSession();
    rig.press('45');
    const before = JSON.stringify(rig.state);
    const event = { type: 'send', sessionId: 'x', messageId: 1 };
    const eventBefore = JSON.stringify(event);
    reduce(rig.state, event, 99);
    expect(JSON.stringify(rig.state)).toBe(before);
    expect(JSON.stringify(event)).toBe(eventBefore);
  });

  it('returns the same state object for an event it does not know', () => {
    const rig = rigHome();
    const result = reduce(rig.state, { type: 'wiggle' } as any, 0);
    expect(result.state).toBe(rig.state);
  });
});
