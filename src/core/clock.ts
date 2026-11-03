// Time abstraction for the ledger

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date()
};

/**
 * Creates a mock clock for testing with a fixed date
 */
export function mockClock(date: Date): Clock {
  return {
    now: () => date
  };
}
