// Checks every screen and reply the ledger can show against the limits in .kiro/steering/screens.md.
//
// Run with `npm run check:screens` (it builds `dist/` first). It renders every session in `WORST_SESSIONS` for each
// of the seven currencies, with the longest realistic data (a 24-character shop name, 20-character names and
// items, amounts of 999,999.99).
//
// Dialled-menu sessions (through `runMenu`): each response is checked:
//   - starts `CON ` or `END `, at most 182 characters after that, plain ASCII;
//   - the "too big to show" fallback appears only in the session built to cause it (`hugeFigures`): anywhere else it
//     means a screen grew past the limit and was replaced, and that fails the check;
//   - every screen id in SCREEN_IDS was shown at least once (a screen nobody renders fails the check).
//
// Text-message conversations (through `handleText`): each reply is checked with `smsProblems`: at most 160
// characters and plain ASCII. A build without `dist/src/channels/sms/handler.js` fails the check.
//
// Each failure is printed as `<currency> <session> <text> -> <length> <problem>`. Exit code 1 on any failure.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SMS_LIMIT, USSD_LIMIT, smsProblems, ussdProblems } from '../dist/src/channels/limits.js';
import { SCREEN_IDS } from '../dist/src/channels/ussd/screen.js';

// The sessions are built on the text-message handler too, so a build without it stops here, with the reason.
const SMS_HANDLER = fileURLToPath(new URL('../dist/src/channels/sms/handler.js', import.meta.url));
if (!existsSync(SMS_HANDLER)) {
  console.error('1 problem:');
  console.error('  - text replies "dist/src/channels/sms/handler.js" -> 0 the text-message handler is missing from the build');
  process.exit(1);
}

const { ALL_CURRENCIES, MENU_SESSIONS, TEXT_SESSIONS, runWorstSession, runWorstTextSession } = await import(
  '../dist/src/channels/ussd/worst-case.js'
);

// A fixed time, so a run is the same every time.
const NOW = new Date('2025-11-03T10:30:00.000Z');

const failures = [];
const fail = (currency, session, text, length, problem) => {
  failures.push(`${currency} ${session} ${JSON.stringify(text)} -> ${length} ${problem}`);
};

// ---------------------------------------------------------------------------
// The dialled menu
// ---------------------------------------------------------------------------

const shownIds = new Set();
let menuScreens = 0;
let longest = { length: 0, where: '' };

for (const currency of ALL_CURRENCIES) {
  for (const session of MENU_SESSIONS) {
    let shown;
    try {
      shown = await runWorstSession(session, currency, NOW);
    } catch (error) {
      fail(currency, session.name, '', 0, `the session threw ${error instanceof Error ? error.name : 'an error'}`);
      continue;
    }
    for (const { text, response, screen } of shown) {
      menuScreens += 1;
      shownIds.add(screen);
      const body = response.startsWith('CON ') || response.startsWith('END ') ? response.slice(4) : response;
      if (body.length > longest.length) longest = { length: body.length, where: `${currency} ${session.name}` };
      for (const problem of ussdProblems(response)) {
        fail(currency, session.name, text, body.length, problem);
      }
      if (screen === 'tooBig' && session.hugeFigures !== true) {
        fail(currency, session.name, text, body.length, 'fell back to the too-big screen: a screen is over the limit');
      }
    }
  }
}

for (const id of SCREEN_IDS) {
  if (!shownIds.has(id)) {
    fail('-', 'screen ids', id, 0, 'this screen was never shown by any session');
  }
}

console.log(
  `menu: ${menuScreens} screens in ${MENU_SESSIONS.length} sessions x ${ALL_CURRENCIES.length} currencies, ` +
    `${shownIds.size} of ${SCREEN_IDS.length} screen ids shown, longest ${longest.length} of ${USSD_LIMIT} (${longest.where})`
);

// ---------------------------------------------------------------------------
// The text messages
// ---------------------------------------------------------------------------

let textReplies = 0;
let longestReply = { length: 0, where: '' };

for (const currency of ALL_CURRENCIES) {
  for (const session of TEXT_SESSIONS) {
    let shown;
    try {
      shown = await runWorstTextSession(session, currency, NOW);
    } catch (error) {
      fail(currency, session.name, '', 0, `the conversation threw ${error instanceof Error ? error.name : 'an error'}`);
      continue;
    }
    for (const { message, reply } of shown) {
      textReplies += 1;
      if (reply.length > longestReply.length) longestReply = { length: reply.length, where: `${currency} ${session.name}` };
      for (const problem of smsProblems(reply)) {
        fail(currency, session.name, message, reply.length, problem);
      }
    }
  }
}
console.log(
  `text: ${textReplies} replies in ${TEXT_SESSIONS.length} conversations x ${ALL_CURRENCIES.length} currencies, ` +
    `longest ${longestReply.length} of ${SMS_LIMIT} (${longestReply.where})`
);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log('check:screens: all screens are within their limits');
