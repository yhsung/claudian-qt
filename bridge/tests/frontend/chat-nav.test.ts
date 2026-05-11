import { describe, it, expect } from 'vitest';
import { navigateUp, navigateDown } from '../../../resources/chat/chat-nav.js';

describe('navigateUp', () => {
  it('returns previous index when in the middle', () => {
    expect(navigateUp(3, 10)).toBe(2);
  });

  it('wraps to last index when at index 0', () => {
    expect(navigateUp(0, 5)).toBe(4);
  });

  it('wraps to last index when not yet focused (idx -1)', () => {
    expect(navigateUp(-1, 5)).toBe(4);
  });

  it('returns -1 when count is 0 (no messages)', () => {
    expect(navigateUp(0, 0)).toBe(-1);
  });
});

describe('navigateDown', () => {
  it('returns next index when not at end', () => {
    expect(navigateDown(2, 5)).toBe(3);
  });

  it('stops at last index', () => {
    expect(navigateDown(4, 5)).toBe(4);
  });

  it('starts at 0 when not yet focused (idx -1)', () => {
    expect(navigateDown(-1, 5)).toBe(0);
  });

  it('returns -1 when count is 0 (no messages)', () => {
    expect(navigateDown(0, 0)).toBe(-1);
  });
});
