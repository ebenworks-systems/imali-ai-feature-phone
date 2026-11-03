import { describe, it, expect } from 'vitest';
import { systemClock, mockClock } from '../../src/core/clock';

describe('clock', () => {
  it('systemClock returns current date', () => {
    const now = new Date();
    const result = systemClock.now();
    expect(result).toBeInstanceOf(Date);
    // Allow small time difference
    expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(1000);
  });

  it('mockClock returns fixed date', () => {
    const fixedDate = new Date('2024-01-15T10:30:00Z');
    const clock = mockClock(fixedDate);
    
    const result1 = clock.now();
    const result2 = clock.now();
    
    expect(result1.getTime()).toBe(fixedDate.getTime());
    expect(result2.getTime()).toBe(fixedDate.getTime());
  });
});
