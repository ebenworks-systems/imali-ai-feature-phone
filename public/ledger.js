// The ledger panel, the three buttons, localStorage and the shop lifecycle.
// This file only draws, listens, sets timers, calls the api helper and uses localStorage.
// Every rule it needs lives in ledger-logic.js. All server and owner text goes in with textContent.

import { ApiError, ROUTES, exportUrl, ledgerUrl } from './api.js';
import {
  DEFAULT_TIME_ZONE,
  currencyLabel,
  demoPhone,
  exportFileName,
  formatMoney,
  isDemoPhone,
  readLedger,
  recordRows,
  sortOwes,
  splitOwes,
} from './ledger-logic.js';

export const STORAGE_KEY = 'imali-demo-phone';
const MAX_TRIES = 3;
const SHOWN_OWES = 6;

const TEXT = Object.freeze({
  refreshError: 'Could not refresh. Try again.',
  exportError: 'Could not export. Try again.',
  startError: 'Could not start the demo shop. Try again.',
  starting: 'Starting...',
  exporting: 'Exporting...',
  started: 'Demo shop started',
  startedOver: 'Started over with a new demo number',
  exported: 'Export saved',
  defaultTitle: 'Shop ledger',
});

/** Make an element with text (never markup). */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {object} options
 * @param {Document} options.root
 * @param {{ postJson: Function, getJson: Function, getBlob: Function }} options.api
 * @param {Storage | null} options.storage may throw when used (private mode)
 * @param {() => number} options.random returns an unsigned 32-bit integer
 * @param {(phone: string | null) => void} options.onShop
 * @param {(ledger: object) => void} [options.onData]
 */
export function initLedger({ root, api, storage, random, onShop, onData = () => {} }) {
  const $ = (id) => root.getElementById(id);
  const els = {
    section: $('ledger'),
    title: $('ledger-title'),
    meta: $('shop-meta'),
    none: $('ledger-none'),
    loading: $('ledger-loading'),
    body: $('ledger-body'),
    figSales: $('fig-sales'),
    figCount: $('fig-count'),
    figSpent: $('fig-spent'),
    figInHand: $('fig-inhand'),
    owesList: $('owes-list'),
    owesEmpty: $('owes-empty'),
    owesMore: $('owes-more'),
    owesExtra: $('owes-extra'),
    recordsList: $('records-list'),
    recordsEmpty: $('records-empty'),
    panelError: $('panel-error'),
    retry: $('retry-btn'),
    actionError: $('action-error'),
    ctaError: $('cta-error'),
    cta: $('start-cta'),
    startButtons: [...root.querySelectorAll('[data-start]')],
    over: $('over-btn'),
    export: $('export-btn'),
    status: $('panel-status'),
  };

  let phone = null; // the demo number, or null before a shop exists
  let data = null; // the checked ledger answer
  let refreshFailed = false;
  let expanded = false;
  const busy = { start: false, over: false, export: false };
  let memoryPhone = null; // used when localStorage throws
  let running = false;
  let again = false;

  // ------------------------------------------------------------------------------------------------------------
  // Storage (requirement 85)
  // ------------------------------------------------------------------------------------------------------------

  function readStored() {
    try {
      const value = storage ? storage.getItem(STORAGE_KEY) : memoryPhone;
      return isDemoPhone(value) ? value : null;
    } catch {
      return isDemoPhone(memoryPhone) ? memoryPhone : null;
    }
  }
  function writeStored(value) {
    memoryPhone = value;
    try {
      if (!storage) return;
      if (value === null) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, value);
    } catch {
      // keep the number in memory for this visit
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Announcements (requirement 89)
  // ------------------------------------------------------------------------------------------------------------

  function say(message) {
    els.status.textContent = '';
    setTimeout(() => {
      els.status.textContent = message;
    }, 60);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------------------------------------------------

  function setBusyLabel(button, isBusy, label, idleLabel) {
    button.querySelector('.btn__label').textContent = isBusy ? label : idleLabel;
    if (isBusy) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  function drawButtons() {
    const hasShop = phone !== null;
    const anyBusy = busy.start || busy.over || busy.export;
    for (const button of els.startButtons) {
      button.setAttribute('aria-disabled', String(hasShop || busy.start));
      setBusyLabel(button, busy.start, TEXT.starting, 'Start demo shop');
    }
    els.over.setAttribute('aria-disabled', String(!hasShop || anyBusy));
    setBusyLabel(els.over, busy.over, TEXT.starting, 'Start over');
    els.export.setAttribute('aria-disabled', String(!hasShop || anyBusy));
    setBusyLabel(els.export, busy.export, TEXT.exporting, 'Export records');
    els.cta.hidden = hasShop;
  }

  function drawOwes(ledger) {
    const sorted = sortOwes(ledger.whoOwes);
    const { shown, hidden } = splitOwes(sorted, SHOWN_OWES);
    if (hidden.length === 0) expanded = false;
    const list = expanded ? sorted : shown;
    els.owesList.replaceChildren(
      ...list.map((entry) => {
        const item = el('li');
        item.append(el('span', 'owes-name', entry.name), el('span', 'owes-amount', formatMoney(entry.owed, ledger.shop.currency)));
        return item;
      }),
    );
    els.owesList.hidden = sorted.length === 0;
    els.owesEmpty.hidden = sorted.length > 0;
    els.owesMore.hidden = hidden.length === 0;
    els.owesMore.textContent = `Show all ${sorted.length}`;
    els.owesMore.setAttribute('aria-expanded', String(expanded));
    // The server sends at most 20 names. Say so when it left some out, so the list is never mistaken for all of them.
    els.owesExtra.hidden = ledger.owesMore === 0;
    els.owesExtra.textContent = ledger.owesMore === 1 ? '1 more person owes money.' : `${ledger.owesMore} more people owe money.`;
  }

  function drawRecords(ledger) {
    const rows = recordRows(ledger.records, ledger.shop.currency, ledger.shop.timeZone, Date.now());
    els.recordsList.replaceChildren(
      ...rows.map((row) => {
        const item = el('li', 'rec');
        if (row.isReversal) {
          // An Undo row is one plain sentence ("Undo: cancelled Owes R20 Tendai (sugar)"), then the time and channel.
          item.classList.add('rec--reversal');
          item.append(
            el('span', 'rec-note', row.undoText),
            el('span', 'rec-time', row.timeText),
            el('span', 'rec-chan', row.channelWord),
          );
          return item;
        }
        if (row.undone) item.classList.add('rec--undone');
        const note = el('span', 'rec-note');
        if (row.detail) note.append(el('span', 'rec-detail', row.detail));
        if (row.undone) {
          if (row.detail) note.append(' ');
          note.append(el('span', 'rec-flag', 'undone'));
        }
        item.append(
          el('span', 'rec-kind', row.kindWord),
          el('span', 'rec-amount', row.amountText),
          el('span', 'rec-time', row.timeText),
          note,
          el('span', 'rec-chan', row.channelWord),
        );
        return item;
      }),
    );
    els.recordsList.hidden = rows.length === 0;
    els.recordsEmpty.hidden = rows.length > 0;
  }

  function draw() {
    drawButtons();
    const hasShop = phone !== null;
    const waiting = hasShop && data === null && !refreshFailed;
    els.section.setAttribute('aria-busy', String(waiting));
    els.none.hidden = hasShop;
    els.loading.hidden = !waiting;
    els.body.hidden = !(hasShop && data !== null);
    els.panelError.hidden = !(hasShop && refreshFailed);

    if (!hasShop || data === null) {
      els.title.textContent = TEXT.defaultTitle;
      els.meta.textContent = '';
      return;
    }
    const { shop, today } = data;
    els.title.textContent = shop.name;
    els.meta.textContent = currencyLabel(shop.currency);
    els.figSales.textContent = formatMoney(today.sales, shop.currency);
    els.figCount.textContent = `(${today.salesCount})`;
    els.figSpent.textContent = formatMoney(today.spent, shop.currency);
    els.figInHand.textContent = formatMoney(today.inHand, shop.currency);
    drawOwes(data);
    drawRecords(data);
  }

  function showActionError(message) {
    for (const node of [els.actionError, els.ctaError]) {
      node.textContent = message;
      node.hidden = message === '';
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Refresh (requirements 74, 75, 77, 81)
  // ------------------------------------------------------------------------------------------------------------

  function forgetShop() {
    phone = null;
    data = null;
    refreshFailed = false;
    expanded = false;
    writeStored(null);
    draw();
    onShop(null);
  }

  async function fetchOnce() {
    const forPhone = phone;
    try {
      const json = await api.getJson(ledgerUrl(forPhone));
      const checked = readLedger(json);
      if (!checked.ok) throw new ApiError('json', 'The ledger answer was not valid');
      if (phone !== forPhone) return;
      data = checked.ledger;
      refreshFailed = false;
      draw();
      onData(data);
    } catch (error) {
      if (phone !== forPhone) return;
      if (error instanceof ApiError && error.kind === 'http' && error.status === 404) {
        forgetShop();
        return;
      }
      const wasFailed = refreshFailed;
      refreshFailed = true;
      draw();
      if (!wasFailed) say(TEXT.refreshError);
    }
  }

  /** One fetch at a time. A call while one runs is folded into one more fetch afterwards. */
  async function refresh() {
    if (phone === null) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await fetchOnce();
      } while (again && phone !== null);
    } finally {
      running = false;
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Shop lifecycle (requirements 79, 80, 82)
  // ------------------------------------------------------------------------------------------------------------

  const newPhone = () => demoPhone(random() % 10000);

  async function makeShop(kind) {
    if (busy.start || busy.over || busy.export) return;
    busy[kind] = true;
    showActionError('');
    drawButtons();
    let made = null;
    for (let attempt = 0; attempt < MAX_TRIES && made === null; attempt += 1) {
      const candidate = newPhone();
      try {
        await api.postJson(ROUTES.demo, { phone: candidate });
        made = candidate;
      } catch (error) {
        const taken = error instanceof ApiError && error.kind === 'http' && error.status === 409;
        if (!taken) break; // a number that is taken is retried; any other failure stops here
      }
    }
    busy[kind] = false;
    if (made === null) {
      showActionError(TEXT.startError);
      say(TEXT.startError);
      drawButtons();
      return;
    }
    phone = made;
    data = null;
    refreshFailed = false;
    expanded = false;
    writeStored(made);
    draw();
    onShop(made);
    say(kind === 'over' ? TEXT.startedOver : TEXT.started);
    refresh();
  }

  async function exportRecords() {
    if (phone === null || busy.start || busy.over || busy.export) return;
    busy.export = true;
    showActionError('');
    drawButtons();
    try {
      const blob = await api.getBlob(exportUrl(phone));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFileName(Date.now());
      link.rel = 'noopener';
      root.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(TEXT.exported);
    } catch {
      showActionError(TEXT.exportError);
      say(TEXT.exportError);
    } finally {
      busy.export = false;
      drawButtons();
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Buttons
  // ------------------------------------------------------------------------------------------------------------

  const isOff = (button) => button.getAttribute('aria-disabled') === 'true';

  for (const button of els.startButtons) {
    button.addEventListener('click', () => {
      if (!isOff(button)) makeShop('start');
    });
  }
  els.over.addEventListener('click', () => {
    if (!isOff(els.over)) makeShop('over');
  });
  els.export.addEventListener('click', () => {
    if (!isOff(els.export)) exportRecords();
  });
  els.retry.addEventListener('click', () => {
    refresh();
  });
  els.owesMore.addEventListener('click', () => {
    expanded = !expanded;
    if (data) drawOwes(data);
  });

  // ------------------------------------------------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------------------------------------------------

  phone = readStored();
  draw();
  if (phone !== null) {
    onShop(phone);
    refresh();
  }

  return {
    refresh,
    phone: () => phone,
    timeZone: () => data?.shop.timeZone ?? DEFAULT_TIME_ZONE,
  };
}
