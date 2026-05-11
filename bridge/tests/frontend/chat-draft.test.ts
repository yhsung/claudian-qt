import { describe, it, expect } from 'vitest';
import { saveDraft, restoreDraft, clearDraft } from '../../../resources/chat/chat-draft.js';

// Fake storage — behaves like sessionStorage but is a plain Map
function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
}

describe('saveDraft', () => {
  it('stores value keyed by sessionId', () => {
    const s = makeStorage();
    saveDraft('sess-1', 'hello', s);
    expect(s.getItem('draft:sess-1')).toBe('hello');
  });

  it('uses "draft" as key when sessionId is empty string', () => {
    const s = makeStorage();
    saveDraft('', 'hello', s);
    expect(s.getItem('draft:draft')).toBe('hello');
  });

  it('removes key when value is whitespace-only', () => {
    const s = makeStorage();
    saveDraft('sess-1', 'hello', s);
    saveDraft('sess-1', '   ', s);
    expect(s.getItem('draft:sess-1')).toBeNull();
  });
});

describe('restoreDraft', () => {
  it('returns saved value for sessionId', () => {
    const s = makeStorage();
    s.setItem('draft:sess-2', 'world');
    expect(restoreDraft('sess-2', s)).toBe('world');
  });

  it('returns null when no draft exists', () => {
    const s = makeStorage();
    expect(restoreDraft('missing', s)).toBeNull();
  });
});

describe('clearDraft', () => {
  it('removes the draft for sessionId', () => {
    const s = makeStorage();
    s.setItem('draft:sess-3', 'text');
    clearDraft('sess-3', s);
    expect(s.getItem('draft:sess-3')).toBeNull();
  });

  it('is a no-op when no draft exists', () => {
    const s = makeStorage();
    expect(() => clearDraft('nonexistent', s)).not.toThrow();
  });
});
