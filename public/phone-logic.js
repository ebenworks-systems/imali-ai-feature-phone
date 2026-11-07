// Phone logic: typing (multi-tap), dial, path, replies, the counter text, the state machine and the screen model.
// No DOM, no fetch, no timers, no clock reads, no random numbers. Times and ids are passed in.
// Every function returns a new value; none changes its argument. An event that does nothing returns the very same
// state object, so callers can tell "used" from "ignored" with `===`.

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

export const LEDGER_CODE = '*384*46254#';
export const MULTITAP_MS = 900;
export const DIAL_MAX = 20;
export const ENTRY_MAX = 40; // a reply to a menu screen
export const COMPOSE_MAX = 160; // one text message
export const NEAR_PERCENT = 90;

/** The 12 pad keys, with the letters printed under the digits. */
export const PAD = Object.freeze([
  Object.freeze({ key: '1', letters: '' }),
  Object.freeze({ key: '2', letters: 'abc' }),
  Object.freeze({ key: '3', letters: 'def' }),
  Object.freeze({ key: '4', letters: 'ghi' }),
  Object.freeze({ key: '5', letters: 'jkl' }),
  Object.freeze({ key: '6', letters: 'mno' }),
  Object.freeze({ key: '7', letters: 'pqrs' }),
  Object.freeze({ key: '8', letters: 'tuv' }),
  Object.freeze({ key: '9', letters: 'wxyz' }),
  Object.freeze({ key: '*', letters: '' }),
  Object.freeze({ key: '0', letters: '' }),
  Object.freeze({ key: '#', letters: '' }),
]);

/** What each digit key types, in "abc" mode, one tap at a time. */
export const CYCLES = Object.freeze({
  0: ' 0',
  1: ".,?!'@1",
  2: 'abc2',
  3: 'def3',
  4: 'ghi4',
  5: 'jkl5',
  6: 'mno6',
  7: 'pqrs7',
  8: 'tuv8',
  9: 'wxyz9',
});

/** The words the page writes itself. Each is plain ASCII and far under 182 characters. */
export const COPY = Object.freeze({
  firstVisit: 'Press Start demo shop',
  dialHint: `Dial ${LEDGER_CODE}`,
  unknownCode: `Unknown code. Try ${LEDGER_CODE}.`,
  wait: 'Please wait...',
  networkError: 'No network. Try again.',
  emptyThread: 'Text a line like: sold 45 bread',
  me: 'Me: ',
  ledger: 'Imali AI: ',
});

// ---------------------------------------------------------------------------------------------------------------
// Editor (typing)
// ---------------------------------------------------------------------------------------------------------------

const DIGITS = '0123456789';

const isPrintable = (ch) => typeof ch === 'string' && ch.length === 1 && ch >= ' ' && ch <= '~';

/** allow: 'dial' (0-9 * #), 'entry' (printable ASCII except * and #), 'text' (printable ASCII). */
function allows(allow, ch) {
  if (!isPrintable(ch)) return false;
  if (allow === 'dial') return DIGITS.includes(ch) || ch === '*' || ch === '#';
  if (allow === 'entry') return ch !== '*' && ch !== '#';
  return true;
}

/**
 * @param {{ allow: 'dial' | 'entry' | 'text', mode?: '123' | 'abc', max: number }} options
 */
export function createEditor({ allow, mode = '123', max }) {
  return { allow, mode: allow === 'dial' ? '123' : mode, max, text: '', pending: null };
}

/** The character a multi-tap is showing now: a capital while the accepted text is empty. */
function pendingChar(editor) {
  if (!editor.pending) return null;
  const ch = CYCLES[editor.pending.key][editor.pending.index];
  return editor.text === '' && ch >= 'a' && ch <= 'z' ? ch.toUpperCase() : ch;
}

/** Accept the pending character, if any. */
export function acceptPending(editor) {
  const ch = pendingChar(editor);
  if (ch === null) return editor;
  return { ...editor, text: editor.text + ch, pending: null };
}

function append(editor, ch) {
  if (!allows(editor.allow, ch) || editor.text.length >= editor.max) return editor;
  return { ...editor, text: editor.text + ch };
}

/** A pad key. "123" mode adds the digit; "abc" mode starts or advances a multi-tap cycle. */
export function tap(editor, key, now) {
  if (typeof key !== 'string' || key.length !== 1 || !(DIGITS.includes(key) || key === '*' || key === '#')) return editor;
  const settled = acceptPending(editor);
  const literal = editor.mode === '123' || editor.allow === 'dial' || key === '*' || key === '#';
  if (literal) return append(settled, key);

  const cycle = CYCLES[key];
  const { pending } = editor;
  if (pending && pending.key === key && now - pending.at >= 0 && now - pending.at < MULTITAP_MS) {
    return { ...editor, pending: { key, index: (pending.index + 1) % cycle.length, at: now } };
  }
  // Another key, or too late: the pending character stays, and a new one starts if there is room.
  if (settled.text.length >= settled.max) return settled;
  return { ...settled, pending: { key, index: 0, at: now } };
}

/** A character from the computer keyboard: accept pending, then add `ch` if the editor takes it. */
export function typeChar(editor, ch) {
  return append(acceptPending(editor), ch);
}

/** Drop the pending character, or else the last character. */
export function backspace(editor) {
  if (editor.pending) return { ...editor, pending: null };
  if (editor.text === '') return editor;
  return { ...editor, text: editor.text.slice(0, -1) };
}

/** Accept pending and flip between "123" and "abc". No effect on the dial line. */
export function toggleMode(editor) {
  if (editor.allow === 'dial') return editor;
  const settled = acceptPending(editor);
  return { ...settled, mode: settled.mode === '123' ? 'abc' : '123' };
}

/** Accept the pending character when 900 ms or more have passed since the last tap. */
export function settle(editor, now) {
  if (!editor.pending || !(now - editor.pending.at >= MULTITAP_MS)) return editor;
  return acceptPending(editor);
}

/** Replace the text (for the ledger code and for a message put back after a failure). */
export function setText(editor, text) {
  let next = { ...editor, text: '', pending: null };
  for (const ch of String(text)) next = append(next, ch);
  return next;
}

/** @returns {{ text: string, pendingIndex: number | null, mode: '123' | 'abc' }} text includes the pending character. */
export function view(editor) {
  const ch = pendingChar(editor);
  return { text: editor.text + (ch ?? ''), pendingIndex: ch === null ? null : editor.text.length, mode: editor.mode };
}

export function isEmpty(editor) {
  return editor.text === '' && !editor.pending;
}

/** Printable ASCII only, trimmed at both ends. An empty result means "ignore the send". */
export function trimEntry(text) {
  let clean = '';
  for (const ch of String(text)) if (isPrintable(ch)) clean += ch;
  return clean.trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Dial, path, replies, counter
// ---------------------------------------------------------------------------------------------------------------

/** 'empty' | 'ledger' (exactly the ledger code) | 'unknown'. */
export function classifyDial(text) {
  if (text === '') return 'empty';
  return text === LEDGER_CODE ? 'ledger' : 'unknown';
}

/** The text the network would send: the path and the new entry joined with `*`. 0 and 00 are ordinary entries. */
export function buildUssdText(path, entry) {
  return [...path, entry].join('*');
}

const safeCount = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

/** @returns {{ ok: true, kind: 'CON' | 'END', lines: string[], chars: number | null, limit: number | null } | { ok: false }} */
export function parseUssdReply(json) {
  if (typeof json !== 'object' || json === null) return { ok: false };
  const { response } = json;
  if (typeof response !== 'string') return { ok: false };
  const kind = response.startsWith('CON ') ? 'CON' : response.startsWith('END ') ? 'END' : null;
  if (kind === null) return { ok: false };
  return { ok: true, kind, lines: response.slice(4).split('\n'), chars: safeCount(json.chars), limit: safeCount(json.limit) };
}

/** @returns {{ ok: true, text: string, chars: number | null, limit: number | null } | { ok: false }} */
export function parseSmsReply(json) {
  if (typeof json !== 'object' || json === null) return { ok: false };
  const { reply } = json;
  if (typeof reply !== 'string' || reply.trim() === '') return { ok: false };
  return { ok: true, text: reply, chars: safeCount(json.chars), limit: safeCount(json.limit) };
}

/**
 * The counter under the phone. Integer maths only.
 * @param {'menu' | 'text'} kind
 * @returns {{ text: string, level: 'ok' | 'near' | 'over' } | null} null when the numbers are missing
 */
export function counterInfo(kind, chars, limit) {
  if (safeCount(chars) === null || safeCount(limit) === null) return null;
  const base = kind === 'menu' ? `This screen: ${chars} of ${limit} characters` : `Reply: ${chars} of ${limit} characters`;
  if (chars > limit) return { text: `${base} - over the limit`, level: 'over' };
  // BigInt keeps chars * 100 exact for any safe integer.
  const near = limit > 0 && BigInt(chars) * 100n >= BigInt(limit) * BigInt(NEAR_PERCENT);
  return near ? { text: `${base} - near the limit`, level: 'near' } : { text: base, level: 'ok' };
}

// ---------------------------------------------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------------------------------------------

const dialEditor = () => createEditor({ allow: 'dial', max: DIAL_MAX });
const entryEditor = () => createEditor({ allow: 'entry', mode: '123', max: ENTRY_MAX });
const composeEditor = (mode = 'abc') => createEditor({ allow: 'text', mode, max: COMPOSE_MAX });

/** A phone with no demo shop yet. */
export function createPhone() {
  return {
    phone: null,
    view: 'noShop',
    editor: dialEditor(),
    notice: null,
    screenId: 0,
    session: null,
    thread: [],
    sms: null,
    counter: null,
    seq: 0,
  };
}

const done = (state, effects = []) => ({ state, effects });

/** Back to the home screen: empty dial line, no notice, no counter, session dropped, thread kept. */
function goHome(state) {
  return {
    ...state,
    view: 'home',
    editor: dialEditor(),
    notice: null,
    session: null,
    counter: null,
    screenId: state.screenId + 1,
  };
}

/** Run an editor change; if the editor did not change, the state did not either. */
function edit(state, fn) {
  const editor = fn(state.editor);
  if (editor === state.editor) return done(state);
  return done({ ...state, editor, notice: state.view === 'home' ? null : state.notice });
}

function sessionCounter(reply) {
  return reply.chars !== null && reply.limit !== null ? { kind: 'menu', chars: reply.chars, limit: reply.limit } : null;
}

const hasId = (id) => (typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id));

/**
 * @param {object} state from createPhone()
 * @param {object} event see the event table in design.md
 * @param {number} now milliseconds, used only for multi-tap
 * @returns {{ state: object, effects: object[] }}
 */
export function reduce(state, event, now = 0) {
  if (event.type === 'shop') {
    const phone = typeof event.phone === 'string' && event.phone !== '' ? event.phone : null;
    return done({
      ...createPhone(),
      phone,
      view: phone ? 'home' : 'noShop',
      screenId: state.screenId + 1,
      seq: state.seq,
    });
  }

  if (state.view === 'noShop') return done(state);

  const inSession = state.view === 'session' && state.session !== null;
  const ended = inSession && state.session.phase === 'ended';
  const loading = inSession && state.session.phase === 'loading';

  switch (event.type) {
    case 'press':
    case 'char':
    case 'backspace':
    case 'mode': {
      if (ended) return done(goHome(state));
      if (loading) return done(state);
      if (event.type === 'press') return edit(state, (editor) => tap(editor, event.key, now));
      if (event.type === 'char') return edit(state, (editor) => typeChar(editor, event.ch));
      if (event.type === 'backspace') return edit(state, backspace);
      return edit(state, toggleMode);
    }

    case 'tick':
      return edit(state, (editor) => settle(editor, now));

    case 'soft': {
      if (event.side !== 'left' && event.side !== 'right') return done(state);
      if (ended) return done(goHome(state));
      if (event.side === 'left') {
        if (state.view === 'home') {
          return done({
            ...state,
            view: 'messages',
            editor: composeEditor(),
            notice: null,
            counter: null,
            screenId: state.screenId + 1,
          });
        }
        return done(goHome(state)); // Cancel in a session, Back in Messages
      }
      if (loading) return done(state);
      if (state.view === 'home' && isEmpty(state.editor)) {
        return done({ ...state, editor: setText(state.editor, LEDGER_CODE), notice: null });
      }
      return edit(state, backspace);
    }

    case 'end': {
      if (state.view === 'home') {
        if (isEmpty(state.editor) && state.notice === null) return done(state);
        return done({ ...state, editor: dialEditor(), notice: null });
      }
      return done(goHome(state));
    }

    case 'send':
      return send(state, event, ended, loading);

    case 'ussdReply':
      return ussdReply(state, event);

    case 'smsReply':
      return smsReply(state, event);

    default:
      return done(state);
  }
}

function send(state, event, ended, loading) {
  if (ended) return done(goHome(state));
  if (loading) return done(state);

  if (state.view === 'home') {
    const kind = classifyDial(state.editor.text);
    if (kind === 'empty') return done(state);
    if (kind === 'unknown') return done({ ...state, notice: COPY.unknownCode });
    if (!hasId(event.sessionId)) return done(state);
    return done(
      {
        ...state,
        view: 'session',
        editor: entryEditor(),
        notice: null,
        counter: null,
        screenId: state.screenId + 1,
        session: { id: event.sessionId, path: [], phase: 'loading', lines: [], pendingEntry: null },
      },
      [{ type: 'ussd', body: { phone: state.phone, sessionId: event.sessionId, text: '' } }],
    );
  }

  if (state.view === 'session') {
    const entry = trimEntry(view(state.editor).text);
    if (entry === '' || entry.length > ENTRY_MAX || /[*#]/.test(entry)) return done(state);
    const text = buildUssdText(state.session.path, entry);
    return done(
      { ...state, counter: null, session: { ...state.session, phase: 'loading', pendingEntry: entry } },
      [{ type: 'ussd', body: { phone: state.phone, sessionId: state.session.id, text } }],
    );
  }

  if (state.view === 'messages') {
    const text = trimEntry(view(state.editor).text);
    if (text === '' || text.length > COMPOSE_MAX || state.sms !== null || !hasId(event.messageId)) return done(state);
    const key = state.seq + 1;
    return done(
      {
        ...state,
        seq: key,
        thread: [...state.thread, { key, from: 'me', text, sending: true }],
        sms: { messageId: event.messageId, text, key },
        editor: composeEditor(state.editor.mode),
        counter: null,
      },
      [{ type: 'sms', body: { phone: state.phone, text }, messageId: event.messageId }],
    );
  }

  return done(state);
}

function ussdReply(state, event) {
  const { session } = state;
  // A reply for another session, or after the end key, or when nothing is waiting, is dropped.
  if (state.view !== 'session' || !session || session.id !== event.sessionId || session.phase !== 'loading') {
    return done(state);
  }
  const reply = event.reply;
  const refresh = [{ type: 'refresh' }];

  if (reply && reply.ok === true && reply.kind === 'CON') {
    const path = session.pendingEntry === null ? session.path : [...session.path, session.pendingEntry];
    return done(
      {
        ...state,
        editor: entryEditor(),
        counter: sessionCounter(reply),
        screenId: state.screenId + 1,
        session: { ...session, path, lines: reply.lines, phase: 'reply', pendingEntry: null },
      },
      refresh,
    );
  }

  if (reply && reply.ok === true && reply.kind === 'END') {
    return done(
      {
        ...state,
        editor: entryEditor(),
        counter: sessionCounter(reply),
        screenId: state.screenId + 1,
        session: { ...session, path: [], lines: reply.lines, phase: 'ended', pendingEntry: null },
      },
      refresh,
    );
  }

  return done(
    {
      ...state,
      editor: entryEditor(),
      counter: null,
      screenId: state.screenId + 1,
      session: { ...session, path: [], lines: [COPY.networkError], phase: 'ended', pendingEntry: null },
    },
    refresh,
  );
}

function smsReply(state, event) {
  const { sms } = state;
  if (!sms || sms.messageId !== event.messageId) return done(state);
  const refresh = [{ type: 'refresh' }];
  const reply = event.reply;
  const inMessages = state.view === 'messages';

  if (reply && reply.ok === true) {
    const key = state.seq + 1;
    const thread = state.thread
      .map((line) => (line.key === sms.key ? { ...line, sending: false } : line))
      .concat({ key, from: 'ledger', text: reply.text, sending: false });
    const counter =
      inMessages && reply.chars !== null && reply.limit !== null
        ? { kind: 'text', chars: reply.chars, limit: reply.limit }
        : state.counter;
    return done({ ...state, seq: key, thread, sms: null, counter }, refresh);
  }

  const key = state.seq + 1;
  const thread = state.thread
    .filter((line) => line.key !== sms.key)
    .concat({ key, from: 'system', text: COPY.networkError, sending: false });
  const restore = inMessages && isEmpty(state.editor);
  return done(
    {
      ...state,
      seq: key,
      thread,
      sms: null,
      editor: restore ? setText(state.editor, sms.text) : state.editor,
      counter: inMessages ? null : state.counter,
    },
    refresh,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Screen model
// ---------------------------------------------------------------------------------------------------------------

function softLabels(state) {
  const { session } = state;
  switch (state.view) {
    case 'home':
      return { left: 'Messages', centre: 'OK', right: isEmpty(state.editor) ? 'Menu' : 'Clear' };
    case 'session':
      if (session && session.phase === 'loading') return { left: 'Cancel', centre: '', right: '' };
      if (session && session.phase === 'ended') return { left: '', centre: 'OK', right: '' };
      return { left: 'Cancel', centre: 'Send', right: 'Clear' };
    case 'messages':
      return { left: 'Back', centre: 'Send', right: 'Clear' };
    default:
      return { left: '', centre: '', right: '' };
  }
}

function threadLine(line) {
  if (line.from === 'me') return { key: `m${line.key}`, text: COPY.me + line.text, tone: line.sending ? 'dim' : 'me' };
  if (line.from === 'ledger') return { key: `m${line.key}`, text: COPY.ledger + line.text, tone: 'ledger' };
  return { key: `m${line.key}`, text: line.text, tone: 'system' };
}

/**
 * What the LCD, the soft keys and the counter should show.
 * @param {object} state
 * @param {{ phoneText?: string }} [ctx] phoneText is the demo number as written on screen
 */
export function screenModel(state, ctx = {}) {
  let body;
  let entry = null;
  const session = state.session;

  if (state.view === 'noShop') {
    body = [{ key: 'first', text: COPY.firstVisit, tone: 'text' }];
  } else if (state.view === 'home') {
    body = [
      { key: 'number', text: ctx.phoneText ?? '', tone: 'text' },
      { key: 'hint', text: COPY.dialHint, tone: 'hint' },
    ];
    if (state.notice) body.push({ key: 'notice', text: state.notice, tone: 'text' });
    entry = { prompt: '>', ...view(state.editor) };
  } else if (state.view === 'session' && session) {
    if (session.phase === 'loading') {
      body = [{ key: 'wait', text: COPY.wait, tone: 'text' }];
    } else {
      body = session.lines.map((text, i) => ({ key: `l${i}`, text, tone: 'text' }));
      if (session.phase === 'reply') entry = { prompt: '>', ...view(state.editor) };
    }
  } else {
    body = state.thread.map(threadLine);
    if (body.length === 0) body = [{ key: 'empty', text: COPY.emptyThread, tone: 'hint' }];
    entry = { prompt: '>', ...view(state.editor) };
  }

  const counter = state.counter ? counterInfo(state.counter.kind, state.counter.chars, state.counter.limit) : null;
  return {
    screenId: state.screenId,
    body,
    entry,
    softs: softLabels(state),
    busy: state.view === 'session' && session !== null && session.phase === 'loading',
    anyKey: state.view === 'session' && session !== null && session.phase === 'ended',
    scroll: state.view === 'messages' ? 'bottom' : 'top',
    counter,
  };
}
