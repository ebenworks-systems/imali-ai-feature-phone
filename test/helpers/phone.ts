/**
 * A pretend phone for the dialled menu.
 *
 * `dial` sends the empty text first, then each key press with the whole path so far (`""`, `"1"`, `"1*45"`, ...),
 * the way the network does, against whatever store the test passes in. Every response is checked (prefix, plain
 * ASCII, 182 characters) before the test sees it, so a test cannot skip the check.
 */

import { runMenu } from '../../src/channels/ussd/handler.js';
import type { ScreenId } from '../../src/channels/ussd/screen.js';
import { ussdProblems } from '../../src/channels/limits.js';
import type { LedgerStore } from '../../src/core/index.js';

export interface Shown {
  /** The response exactly as the network would send it, `CON ...` or `END ...`. */
  raw: string;
  /** True for `END`. */
  end: boolean;
  /** Everything after the prefix. */
  body: string;
  /** The body split into lines. */
  lines: string[];
  /** Which screen the menu says it showed. */
  screen: ScreenId;
}

/** Throws, with the screen text, when the response breaks a rule of `.kiro/steering/screens.md`. */
export function assertValidScreen(raw: string): void {
  const problems = ussdProblems(raw);
  if (problems.length > 0) {
    throw new Error(`Bad screen (${problems.join(', ')}):\n${JSON.stringify(raw)}`);
  }
}

export interface Phone {
  readonly sessionId: string;
  /** The path so far: what the last request carried. */
  readonly text: string;
  /** Sends `""`. */
  open(): Promise<Shown>;
  /** Adds the input to the path and sends the whole path. */
  press(input: string): Promise<Shown>;
  /** Sends the last request again, byte for byte (the same text and session id). */
  resend(): Promise<Shown>;
}

let sessions = 0;

export function dial(a: { store: LedgerStore; phone: string; now: Date; sessionId?: string }): Phone {
  sessions += 1;
  const sessionId = a.sessionId ?? `ATUid_test_${sessions}`;
  const inputs: string[] = [];
  let text = '';

  async function send(): Promise<Shown> {
    const { response, screen } = await runMenu({
      sessionId,
      serviceCode: '*384*1234#',
      phoneNumber: a.phone,
      text,
      now: a.now,
      store: a.store
    });
    assertValidScreen(response);
    const end = response.startsWith('END ');
    const body = response.slice(4);
    return { raw: response, end, body, lines: body.split('\n'), screen };
  }

  return {
    sessionId,
    get text() {
      return text;
    },
    async open() {
      inputs.length = 0;
      text = '';
      return send();
    },
    async press(input: string) {
      inputs.push(input);
      text = inputs.join('*');
      return send();
    },
    async resend() {
      return send();
    }
  };
}
