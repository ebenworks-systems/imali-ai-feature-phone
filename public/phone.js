// Entry point. Binds keys, runs timers, runs the effects the state machine asks for, and draws the LCD and counter.
// This file only draws, listens, sets timers, calls fetch through the api helper and uses localStorage (through
// ledger.js). Every rule it needs lives in phone-logic.js and ledger-logic.js.

import { createApi, isShopGone, ROUTES } from './api.js';
import { initLedger } from './ledger.js';
import { DEFAULT_TIME_ZONE, displayPhone, formatClock } from './ledger-logic.js';
import { MULTITAP_MS, createPhone, parseSmsReply, parseUssdReply, reduce, screenModel } from './phone-logic.js';

const ECHO_MS = 500;
const PRESS_MS = 120;
const MAX_STAGGER = 14;

const $ = (id) => document.getElementById(id);
const els = {
  phone: $('phone'),
  body: $('lcd-body'),
  entry: $('lcd-entry'),
  entryText: $('lcd-entry-text'),
  mode: $('lcd-mode'),
  modeKey: $('key-mode'),
  clock: $('lcd-clock'),
  counter: $('counter'),
  echo: $('echo'),
  softs: {
    left: $('soft-left'),
    centre: $('soft-centre'),
    right: $('soft-right'),
  },
};
const SIDE_NAMES = { left: 'Left', centre: 'Centre', right: 'Right' };

// -----------------------------------------------------------------------------------------------------------------
// Ids
// -----------------------------------------------------------------------------------------------------------------

function randomHex(bytes) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const newSessionId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : randomHex(16));
let messageCounter = 0;

// -----------------------------------------------------------------------------------------------------------------
// State and dispatch
// -----------------------------------------------------------------------------------------------------------------

const api = createApi();
let state = createPhone();
let ledger = null; // set once initLedger returns
let renderedScreenId = -1;
let tickTimer = 0;

/** Run one event through the state machine, draw, then run the effects it asked for. */
function dispatch(event) {
  const result = reduce(state, event, performance.now());
  const changed = result.state !== state;
  state = result.state;
  if (changed) render();
  armTick();
  for (const effect of result.effects) runEffect(effect);
  return { changed, effects: result.effects };
}

function armTick() {
  clearTimeout(tickTimer);
  if (state.editor.pending) {
    tickTimer = setTimeout(() => dispatch({ type: 'tick' }), MULTITAP_MS + 10);
  }
}

// -----------------------------------------------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------------------------------------------

function runEffect(effect) {
  if (effect.type === 'ussd') runUssd(effect.body);
  else if (effect.type === 'sms') runSms(effect);
  else if (effect.type === 'refresh') ledger?.refresh();
}

/** A request that finished always means the ledger may have changed, even if the reducer dropped the reply. */
function afterRequest(result) {
  if (!result.effects.some((effect) => effect.type === 'refresh')) ledger?.refresh();
}

async function runUssd(body) {
  let reply;
  try {
    reply = parseUssdReply(await api.postJson(ROUTES.ussd, body));
  } catch (error) {
    // No demo shop on this number any more (404): go back to the first-visit state, quietly, as the ledger call does.
    if (isShopGone(error)) {
      ledger?.forget(body.phone);
      return;
    }
    reply = { ok: false };
  }
  afterRequest(dispatch({ type: 'ussdReply', sessionId: body.sessionId, reply }));
}

async function runSms({ body, messageId }) {
  let reply;
  try {
    reply = parseSmsReply(await api.postJson(ROUTES.sms, body));
  } catch (error) {
    if (isShopGone(error)) {
      ledger?.forget(body.phone);
      return;
    }
    reply = { ok: false };
  }
  afterRequest(dispatch({ type: 'smsReply', messageId, reply }));
}

// -----------------------------------------------------------------------------------------------------------------
// Drawing
// -----------------------------------------------------------------------------------------------------------------

const lineEls = new Map(); // key -> element for the screen on show

function makeLine(line, index) {
  const node = document.createElement('p');
  node.className = `lcd-line lcd-line--${line.tone}`;
  node.textContent = line.text;
  node.style.setProperty('--i', String(Math.min(index, MAX_STAGGER)));
  return node;
}

function drawBody(model) {
  const rebuild = model.screenId !== renderedScreenId;
  renderedScreenId = model.screenId;
  if (rebuild) {
    lineEls.clear();
    const nodes = model.body.map((line, index) => {
      const node = makeLine(line, index);
      lineEls.set(line.key, node);
      return node;
    });
    els.body.replaceChildren(...nodes);
    els.body.scrollTop = 0;
  } else {
    // Patch by key: an old line stays as it is, a new line animates alone.
    const keep = new Set(model.body.map((line) => line.key));
    for (const [key, node] of lineEls) {
      if (!keep.has(key)) {
        node.remove();
        lineEls.delete(key);
      }
    }
    model.body.forEach((line, index) => {
      let node = lineEls.get(line.key);
      if (node) {
        const className = `lcd-line lcd-line--${line.tone}`;
        if (node.className !== className) node.className = className;
        if (node.textContent !== line.text) node.textContent = line.text;
      } else {
        node = makeLine(line, 0);
        lineEls.set(line.key, node);
      }
      if (els.body.children[index] !== node) els.body.insertBefore(node, els.body.children[index] ?? null);
    });
  }
  els.body.setAttribute('aria-busy', String(model.busy));
  if (model.scroll === 'bottom') els.body.scrollTop = els.body.scrollHeight;
}

function drawEntry(model) {
  const { entry } = model;
  els.entry.hidden = entry === null;
  if (entry === null) {
    els.entryText.replaceChildren();
    return;
  }
  const nodes = [];
  if (entry.pendingIndex === null) {
    nodes.push(document.createTextNode(entry.text));
  } else {
    const pending = document.createElement('span');
    pending.className = 'lcd-pending';
    pending.textContent = entry.text.slice(entry.pendingIndex);
    nodes.push(document.createTextNode(entry.text.slice(0, entry.pendingIndex)), pending);
  }
  els.entryText.replaceChildren(...nodes);
  els.entryText.scrollTop = els.entryText.scrollHeight;
  els.mode.textContent = entry.mode;
}

function drawSofts(model) {
  for (const side of Object.keys(els.softs)) {
    const button = els.softs[side];
    const label = model.softs[side];
    button.querySelector('.soft-label').textContent = label;
    button.setAttribute('aria-label', `${SIDE_NAMES[side]} soft key, ${label === '' ? 'not used' : label}`);
    // On an END screen every key, even a blank soft key, goes home (requirement 42), so it is not marked off.
    if (label === '' && !model.anyKey) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }
}

function drawMode() {
  const mode = state.editor.mode;
  els.modeKey.setAttribute('aria-label', `Switch typing mode, now ${mode}`);
  for (const half of els.modeKey.querySelectorAll('.mode-half')) {
    half.classList.toggle('is-active', half.dataset.mode === mode);
  }
}

function drawCounter(model) {
  els.counter.textContent = model.counter ? model.counter.text : '';
  if (model.counter) els.counter.dataset.level = model.counter.level;
  else delete els.counter.dataset.level;
}

let lastEntryText = '';
let echoTimer = 0;

/** Tell a screen reader what was typed, once typing pauses. */
function scheduleEcho(model, screenChanged) {
  const text = model.entry ? model.entry.text : '';
  if (screenChanged) {
    clearTimeout(echoTimer);
    lastEntryText = text;
    return;
  }
  if (text === lastEntryText) return;
  lastEntryText = text;
  clearTimeout(echoTimer);
  echoTimer = setTimeout(() => {
    els.echo.textContent = text === '' ? 'Entry empty' : `Entry: ${text}`;
  }, ECHO_MS);
}

function render() {
  const previousScreen = renderedScreenId;
  const model = screenModel(state, { phoneText: displayPhone(state.phone) });
  drawBody(model);
  drawEntry(model);
  drawSofts(model);
  drawMode();
  drawCounter(model);
  scheduleEcho(model, model.screenId !== previousScreen);
}

// -----------------------------------------------------------------------------------------------------------------
// Clock (kept out of the live log)
// -----------------------------------------------------------------------------------------------------------------

function drawClock() {
  els.clock.textContent = formatClock(Date.now(), ledger ? ledger.timeZone() : DEFAULT_TIME_ZONE);
}
function scheduleClock() {
  drawClock();
  const wait = 60000 - (Date.now() % 60000) + 50;
  setTimeout(scheduleClock, wait);
}

// -----------------------------------------------------------------------------------------------------------------
// Keys
// -----------------------------------------------------------------------------------------------------------------

function flash(button) {
  if (!button) return;
  button.classList.add('is-pressed');
  setTimeout(() => button.classList.remove('is-pressed'), PRESS_MS);
}

function send() {
  return dispatch({ type: 'send', sessionId: newSessionId(), messageId: (messageCounter += 1) });
}

function padKey(key) {
  return els.phone.querySelector(`.key--pad[data-key="${CSS.escape(key)}"]`);
}

els.phone.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (!button || !els.phone.contains(button)) return;
  flash(button);
  // After a pointer click, give focus back to the page so Space and Enter on the computer keyboard type and send
  // instead of pressing this key again. A click made from the keyboard (detail 0) keeps its focus.
  if (event.detail > 0) button.blur();

  if (button.dataset.key !== undefined) {
    dispatch({ type: 'press', key: button.dataset.key });
    return;
  }
  if (button.dataset.soft !== undefined) {
    if (button.getAttribute('aria-disabled') === 'true') return; // a soft key with no label does nothing
    if (button.dataset.soft === 'centre') send();
    else dispatch({ type: 'soft', side: button.dataset.soft });
    return;
  }
  switch (button.dataset.action) {
    case 'call':
      send();
      break;
    case 'mode':
      dispatch({ type: 'mode' });
      break;
    case 'end':
      dispatch({ type: 'end' });
      break;
    default:
      break;
  }
});

// The computer keyboard (requirement 62)
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const target = event.target;
  const inPhone = target instanceof Node && els.phone.contains(target);
  if (!(target === document.body || inPhone)) return; // focus on a button outside the phone is left alone
  const onButton = target instanceof Element && target.closest('button') !== null;
  const { key } = event;

  if (key === 'Tab') return;

  if (key === 'Enter') {
    if (onButton) return; // the focused key's own click runs
    event.preventDefault();
    flash(els.softs.centre);
    send();
    return;
  }
  if (key === 'Escape') {
    event.preventDefault();
    flash($('key-end'));
    dispatch({ type: 'end' });
    return;
  }
  if (key === 'Backspace') {
    event.preventDefault();
    flash(els.softs.right);
    dispatch({ type: 'backspace' });
    return;
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (target === els.body) return; // the focused screen scrolls on its own
    event.preventDefault();
    const line = Number.parseFloat(getComputedStyle(els.body).lineHeight) || 20;
    els.body.scrollBy(0, key === 'ArrowUp' ? -line : line);
    return;
  }
  if (key === ' ' && onButton) return; // Space presses the focused key
  if (key.length === 1 && key >= ' ' && key <= '~') {
    const result = dispatch({ type: 'char', ch: key });
    if (result.changed) {
      event.preventDefault();
      flash(padKey(key));
    }
  }
});

// -----------------------------------------------------------------------------------------------------------------
// Reveal (requirement 20) and start
// -----------------------------------------------------------------------------------------------------------------

function setUpReveal() {
  const sections = [...document.querySelectorAll('.reveal')];
  if (!('IntersectionObserver' in window)) {
    for (const section of sections) section.classList.add('is-in');
    return;
  }
  document.documentElement.classList.add('js');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0, rootMargin: '0px 0px -8% 0px' },
  );
  for (const section of sections) observer.observe(section);
}

function start() {
  setUpReveal();
  ledger = initLedger({
    root: document,
    api,
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
    random: () => {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      return array[0];
    },
    onShop: (phone) => {
      dispatch({ type: 'shop', phone });
      drawClock();
    },
    onData: drawClock,
  });
  render();
  scheduleClock();
}

start();
