import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escHtml, relativeTime, shortModelName } from '../../../resources/chat/chat-format.js';

// ---------------------------------------------------------------------------
// escHtml
// ---------------------------------------------------------------------------

describe('escHtml', () => {
  it('escapes ampersand', () => {
    expect(escHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    expect(escHtml('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes double-quote', () => {
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes all four characters together', () => {
    expect(escHtml('<a href="x&y">z</a>')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;z&lt;/a&gt;');
  });

  it('returns plain string unchanged', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });

  it('coerces non-string to string', () => {
    expect(escHtml(42)).toBe('42');
  });

  it('coerces null to string', () => {
    expect(escHtml(null)).toBe('null');
  });
});

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------

describe('relativeTime', () => {
  const FIXED_NOW = new Date('2026-05-16T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for empty input', () => {
    expect(relativeTime('')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(relativeTime(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(relativeTime(undefined)).toBe('');
  });

  it('returns "just now" for 30 seconds ago', () => {
    const iso = new Date(FIXED_NOW - 30_000).toISOString();
    expect(relativeTime(iso)).toBe('just now');
  });

  it('returns "just now" for exactly 0 ms ago', () => {
    expect(relativeTime(new Date(FIXED_NOW).toISOString())).toBe('just now');
  });

  it('returns "1m ago" for exactly 1 minute ago', () => {
    expect(relativeTime(new Date(FIXED_NOW - 60_000).toISOString())).toBe('1m ago');
  });

  it('returns "5m ago" for 5 minutes ago', () => {
    expect(relativeTime(new Date(FIXED_NOW - 5 * 60_000).toISOString())).toBe('5m ago');
  });

  it('returns "59m ago" for 59 minutes ago', () => {
    expect(relativeTime(new Date(FIXED_NOW - 59 * 60_000).toISOString())).toBe('59m ago');
  });

  it('returns "1h ago" for exactly 1 hour ago', () => {
    expect(relativeTime(new Date(FIXED_NOW - 60 * 60_000).toISOString())).toBe('1h ago');
  });

  it('returns "3h ago" for 3 hours ago', () => {
    expect(relativeTime(new Date(FIXED_NOW - 3 * 60 * 60_000).toISOString())).toBe('3h ago');
  });

  it('returns "1d ago" for exactly 1 day ago', () => {
    expect(relativeTime(new Date(FIXED_NOW - 24 * 60 * 60_000).toISOString())).toBe('1d ago');
  });

  it('returns "6d ago" for 6 days ago', () => {
    expect(relativeTime(new Date(FIXED_NOW - 6 * 24 * 60 * 60_000).toISOString())).toBe('6d ago');
  });

  it('returns locale date string for 7 days ago', () => {
    const date = new Date(FIXED_NOW - 7 * 24 * 60 * 60_000);
    expect(relativeTime(date.toISOString())).toBe(date.toLocaleDateString());
  });

  it('returns locale date string for 30 days ago', () => {
    const date = new Date(FIXED_NOW - 30 * 24 * 60 * 60_000);
    expect(relativeTime(date.toISOString())).toBe(date.toLocaleDateString());
  });
});

// ---------------------------------------------------------------------------
// shortModelName
// ---------------------------------------------------------------------------

describe('shortModelName', () => {
  it('strips the claude- prefix', () => {
    expect(shortModelName('claude-opus-4-7')).toBe('opus-4-7');
  });

  it('strips claude- from haiku model', () => {
    expect(shortModelName('claude-haiku-4-5-20251001')).toBe('haiku-4-5-20251001');
  });

  it('leaves a non-claude model name unchanged', () => {
    expect(shortModelName('gpt-4o')).toBe('gpt-4o');
  });

  it('returns "default" for empty string', () => {
    expect(shortModelName('')).toBe('default');
  });

  it('returns "default" for null', () => {
    expect(shortModelName(null)).toBe('default');
  });

  it('returns "default" for undefined', () => {
    expect(shortModelName(undefined)).toBe('default');
  });
});
