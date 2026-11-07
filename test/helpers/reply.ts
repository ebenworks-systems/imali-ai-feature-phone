import { expect } from 'vitest';
import { isPlainAscii, SMS_MAX_LENGTH } from '@/channels/sms/replies.ts';

/**
 * Every reply in every SMS test goes through here (requirements 42 and 50): plain ASCII and at most
 * 160 characters. Returns the reply so a test can compare it.
 */
export function expectSmsReply(reply: string): string {
  expect(typeof reply, 'a reply must be a string').toBe('string');
  expect(isPlainAscii(reply), `not plain ASCII: ${JSON.stringify(reply)}`).toBe(true);
  expect(reply.length, `too long (${reply.length}): ${reply}`).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  expect(reply.length, 'an empty reply').toBeGreaterThan(0);
  return reply;
}
