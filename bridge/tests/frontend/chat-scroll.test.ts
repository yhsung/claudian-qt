import { describe, it, expect } from 'vitest';
import { computeUserScrolled, shouldAutoScroll, SCROLL_THRESHOLD } from '../../../resources/chat/chat-scroll.js';

describe('SCROLL_THRESHOLD', () => {
  it('is 120', () => {
    expect(SCROLL_THRESHOLD).toBe(120);
  });
});

describe('computeUserScrolled', () => {
  it('returns true when user scrolled more than threshold from bottom', () => {
    // scrollHeight=1000, scrollTop=700, clientHeight=300 → distanceFromBottom=0 → false
    expect(computeUserScrolled(700, 1000, 300)).toBe(false);
  });

  it('returns true when user is far from bottom', () => {
    // scrollHeight=1000, scrollTop=0, clientHeight=300 → distanceFromBottom=700 → true
    expect(computeUserScrolled(0, 1000, 300)).toBe(true);
  });

  it('returns true when exactly at threshold', () => {
    // distance = 1000 - 580 - 300 = 120 → true (>= threshold)
    expect(computeUserScrolled(580, 1000, 300)).toBe(true);
  });

  it('returns false when just below threshold', () => {
    // distance = 1000 - 581 - 300 = 119 → false
    expect(computeUserScrolled(581, 1000, 300)).toBe(false);
  });
});

describe('shouldAutoScroll', () => {
  it('returns true when near bottom', () => {
    expect(shouldAutoScroll(700, 1000, 300)).toBe(true);
  });

  it('returns false when far from bottom', () => {
    expect(shouldAutoScroll(0, 1000, 300)).toBe(false);
  });

  it('is the inverse of computeUserScrolled', () => {
    const cases = [
      [0, 1000, 300],
      [580, 1000, 300],
      [581, 1000, 300],
      [700, 1000, 300],
    ] as const;
    for (const [top, h, ch] of cases) {
      expect(shouldAutoScroll(top, h, ch)).toBe(!computeUserScrolled(top, h, ch));
    }
  });
});
