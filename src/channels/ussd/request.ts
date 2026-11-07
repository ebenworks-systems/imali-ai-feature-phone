/**
 * Reading what the network sent: check the fields and split the typed path.
 *
 * Nothing here reads the store. A request that fails these checks is answered without touching it.
 */

import { normalizePhone } from '../phone.js';

export const MAX_TEXT_LENGTH = 500;
export const MAX_INPUTS = 30;
export const MAX_SESSION_ID_LENGTH = 100;

export interface MenuRequest {
  sessionId: string;
  /** The normalised phone number. */
  phone: string;
  /** What the owner typed, one entry per `*`. Empty for the first call. */
  inputs: string[];
}

const SESSION_ID = /^[A-Za-z0-9_.-]+$/;

export function readRequest(p: {
  sessionId: string;
  phoneNumber: string;
  text: string;
}): { ok: true; request: MenuRequest } | { ok: false } {
  if (typeof p.sessionId !== 'string' || typeof p.phoneNumber !== 'string' || typeof p.text !== 'string') {
    return { ok: false };
  }
  if (p.sessionId.length === 0 || p.sessionId.length > MAX_SESSION_ID_LENGTH || !SESSION_ID.test(p.sessionId)) {
    return { ok: false };
  }
  const phone = normalizePhone(p.phoneNumber);
  if (phone === null) {
    return { ok: false };
  }
  if (p.text.length > MAX_TEXT_LENGTH) {
    return { ok: false };
  }
  // An empty text is the first call: no inputs. Every `*` splits; an empty piece stays as an empty input.
  const inputs = p.text === '' ? [] : p.text.split('*');
  if (inputs.length > MAX_INPUTS) {
    return { ok: false };
  }
  return { ok: true, request: { sessionId: p.sessionId, phone, inputs } };
}
