/**
 * Phone number helpers for the server.
 *
 * `normalizePhone` is the one the dialled menu and the text handler already use (`src/channels/phone.ts`), so the
 * routes, the menu and the texts always find the same shop for a number.
 */

import { isDemoNumber } from '../store/demo.js';

export { normalizePhone } from '../channels/phone.js';

/** True for a normalised demo number: `+2700000` followed by four digits (`+27 00 000 xxxx` without spaces). */
export function isDemoPhone(phone: string): boolean {
  return isDemoNumber(phone);
}

/** The first 4 characters, `***`, and the last 2. For logs: the middle digits never show. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

/** The longest address kept. A real one is at most 45 characters (IPv6); a longer header value is cut. */
const MAX_ADDRESS_LENGTH = 64;

const UNKNOWN_ADDRESS = 'unknown';

/** Eight 16-bit groups of an IPv6 address written in any of its short forms, or null when the text is not one. */
function parseIpv6(text: string): number[] | null {
  let rest = text;
  // A dotted IPv4 tail (`::ffff:192.0.2.1`) stands for the last two groups.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(rest);
  if (dotted) {
    const octets = dotted.slice(2, 6).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const hex = (high: number, low: number): string => (high * 256 + low).toString(16);
    rest = `${dotted[1]}${hex(octets[0]!, octets[1]!)}:${hex(octets[2]!, octets[3]!)}`;
  }
  const halves = rest.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === '') return [];
    const parsed: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      parsed.push(parseInt(group, 16));
    }
    return parsed;
  };
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const zeros = 8 - head.length - tail.length; // `::` stands for at least one group of zeros
  return zeros >= 1 ? [...head, ...Array<number>(zeros).fill(0), ...tail] : null;
}

/**
 * The key one client is counted under. An IPv6 client usually holds a whole /64, so it can send each request from a
 * new address in it; the limits would never meet it. So an address with a `:` is cut to its first four groups (its
 * /64, after `::` is expanded so the four groups are the real ones). An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`)
 * counts as the IPv4 address. An IPv4 address stays as it is. Text with a `:` that is not an IPv6 address counts under
 * the one shared key, so a caller cannot make a new key by writing a new string.
 */
function limitKey(address: string): string {
  let text = address.toLowerCase();
  const bracket = /^\[([^\]]*)\](?::\d{1,5})?$/.exec(text); // `[2001:db8::1]` and `[2001:db8::1]:443`
  if (bracket) text = bracket[1]!;
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(text); // `192.0.2.1:443`
  if (withPort) return withPort[1]!;
  if (!text.includes(':')) return address;

  const zone = text.indexOf('%'); // `fe80::1%eth0`
  const groups = parseIpv6(zone === -1 ? text : text.slice(0, zone));
  if (groups === null) return UNKNOWN_ADDRESS;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high, low] = [groups[6]!, groups[7]!];
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return groups.slice(0, 4).map((group) => group.toString(16)).join(':');
}

/**
 * The address of the caller, for the limits. See `limitKey` for what is done with an IPv6 address.
 *
 * 1. `x-real-ip`. Vercel sets it to the address that connected to it, and a caller cannot write it.
 * 2. The last entry of `x-forwarded-for`. A proxy adds the address it saw to the end of that header, so the entry on
 *    the right is the one the platform added. The first entry is whatever the caller wrote, so it is never used.
 * 3. `unknown`, one shared key (a local run behind no proxy, and tests).
 */
export function clientAddress(headers: { get(name: string): string | null | undefined }): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return limitKey(real.slice(0, MAX_ADDRESS_LENGTH));
  const entries = headers.get('x-forwarded-for')?.split(',') ?? [];
  const last = entries[entries.length - 1]?.trim();
  if (last) return limitKey(last.slice(0, MAX_ADDRESS_LENGTH));
  return UNKNOWN_ADDRESS;
}
