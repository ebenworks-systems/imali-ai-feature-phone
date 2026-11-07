/**
 * Screen limits for the two channels, and the checks the tests and `check:screens` use.
 *
 * - A dialled menu (USSD) response is `CON ` or `END ` and then at most 182 characters.
 * - A text message reply is at most 160 characters (one GSM-7 message).
 * - Both are plain ASCII: characters 32 to 126, and a newline between lines.
 */

export const USSD_LIMIT = 182;
export const SMS_LIMIT = 160;

const PREFIXES = ['CON ', 'END '] as const;

/** True when every character is plain ASCII: 32 to 126, or a newline. */
export function isPlainAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) continue;
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/** What is wrong with a dialled-menu response. An empty list means it is fine. */
export function ussdProblems(response: string): string[] {
  const problems: string[] = [];
  const prefix = PREFIXES.find((p) => response.startsWith(p));
  if (prefix === undefined) {
    problems.push('no CON/END prefix');
  }
  const body = prefix === undefined ? response : response.slice(prefix.length);
  if (body.length > USSD_LIMIT) {
    problems.push(`over ${USSD_LIMIT} characters`);
  }
  if (!isPlainAscii(response)) {
    problems.push('not plain ASCII');
  }
  return problems;
}

/** What is wrong with a text message reply. An empty list means it is fine. */
export function smsProblems(reply: string): string[] {
  const problems: string[] = [];
  if (reply.length > SMS_LIMIT) {
    problems.push(`over ${SMS_LIMIT} characters`);
  }
  if (!isPlainAscii(reply)) {
    problems.push('not plain ASCII');
  }
  return problems;
}
