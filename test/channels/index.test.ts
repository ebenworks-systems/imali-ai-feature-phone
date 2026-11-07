import { describe, it, expect } from 'vitest';
import * as channels from '../../src/channels/index.js';
import * as entry from '../../src/index.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { createShop } from '../../src/core/index.js';
import type { HandleUssdParams, HandleUssdResult } from '../../src/channels/index.js';

describe('src/channels/index.ts', () => {
  it('exports handleUssd', () => {
    expect(typeof channels.handleUssd).toBe('function');
  });

  it('exports only handleUssd from the menu: no runMenu and no renderers', () => {
    const names = Object.keys(channels);
    for (const hidden of [
      'runMenu',
      'replay',
      'toResponse',
      'mainMenu',
      'confirmScreen',
      'savedScreen',
      'saveDraft',
      'undoLast',
      'makePorts',
      'readRequest',
      'readAmount',
      'recordIdFor',
      'shopIdFor',
      'WORST_SESSIONS',
      'SCREEN_IDS',
      'ussdProblems',
      'normalizePhone'
    ]) {
      expect(names, hidden).not.toContain(hidden);
    }
  });

  it('still exports what the text messages already exported', () => {
    for (const name of ['handleText', 'InMemoryPendingStore', 'buildReply', 'readIntent', 'checkProposal', 'GeminiReader']) {
      expect(typeof (channels as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('is also reachable from the package entry', () => {
    expect(entry.handleUssd).toBe(channels.handleUssd);
  });

  it('has the documented signature: { response } from the five fields, a time and a store', async () => {
    const store = new MemoryStore();
    await store.createShop(
      createShop({ name: 'Demo Spaza', phone: '+27000001234', currency: 'ZAR', timeZone: 'Africa/Johannesburg' })
    );
    const params: HandleUssdParams = {
      sessionId: 'ATUid_1',
      serviceCode: '*384*1234#',
      phoneNumber: '+27000001234',
      text: '',
      now: new Date('2025-11-03T10:30:00.000Z'),
      store
    };
    const result: HandleUssdResult = await channels.handleUssd(params);
    expect(result.response.startsWith('CON Demo Spaza')).toBe(true);
  });
});
