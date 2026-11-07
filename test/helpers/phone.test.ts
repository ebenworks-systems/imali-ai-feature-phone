import { describe, it, expect } from 'vitest';
import { assertValidScreen, dial } from './phone.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { DEMO_PHONE, NOW, seedShop } from './fixtures.js';

describe('dial', () => {
  it('sends "", then "1", then "1*45" for open, press("1"), press("45")', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    expect(phone.text).toBe('');
    await phone.open();
    expect(phone.text).toBe('');
    await phone.press('1');
    expect(phone.text).toBe('1');
    await phone.press('45');
    expect(phone.text).toBe('1*45');
  });

  it('shows the main menu on open and the amount prompt after 1', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    const menu = await phone.open();
    expect(menu.end).toBe(false);
    expect(menu.lines[0]).toBe('Demo Spaza');
    expect(menu.screen).toBe('main');
    const amount = await phone.press('1');
    expect(amount.lines[0]).toBe('Sale amount?');
    expect(amount.raw.startsWith('CON ')).toBe(true);
    expect(amount.body).toBe(amount.raw.slice(4));
  });

  it('resend sends the same text and session id again', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.open();
    for (const key of ['1', '45', '1']) await phone.press(key);
    const saved = await phone.press('1');
    expect(saved.end).toBe(true);
    const sessionBefore = phone.sessionId;
    const textBefore = phone.text;
    const again = await phone.resend();
    expect(phone.text).toBe(textBefore);
    expect(phone.sessionId).toBe(sessionBefore);
    expect(again.raw).toBe(saved.raw);
    expect(await store.listRecords((await store.findShopByPhone(DEMO_PHONE))!.id)).toHaveLength(1);
  });

  it('can start with a press, without open', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    const shown = await phone.press('5');
    expect(phone.text).toBe('5');
    expect(shown.end).toBe(true);
  });

  it('open starts the path again', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.press('1');
    await phone.open();
    expect(phone.text).toBe('');
  });

  it('gives different session ids to two phones, and uses the one it is given', () => {
    const store = new MemoryStore();
    const a = dial({ store, phone: DEMO_PHONE, now: NOW });
    const b = dial({ store, phone: DEMO_PHONE, now: NOW });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(dial({ store, phone: DEMO_PHONE, now: NOW, sessionId: 'mine_1' }).sessionId).toBe('mine_1');
  });
});

describe('assertValidScreen', () => {
  it('throws for a response with no prefix', () => {
    expect(() => assertValidScreen('Hello')).toThrow(/no CON\/END prefix/);
  });

  it('throws for a body of 183 characters and shows the screen text', () => {
    const raw = `CON ${'a'.repeat(183)}`;
    expect(() => assertValidScreen(raw)).toThrow(/over 182/);
    expect(() => assertValidScreen(raw)).toThrow(raw.slice(0, 20));
  });

  it('throws for an e-acute', () => {
    expect(() => assertValidScreen('END caf\u00e9')).toThrow(/not plain ASCII/);
  });

  it('accepts a body of exactly 182 characters', () => {
    expect(() => assertValidScreen(`CON ${'a'.repeat(182)}`)).not.toThrow();
    expect(() => assertValidScreen(`END ${'a'.repeat(100)}\n${'b'.repeat(81)}`)).not.toThrow();
  });
});
