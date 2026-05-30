import { describe, it, expect } from 'vitest';
import {
  buildSourceRef,
  groupRecordsByType,
  loadRecords,
  promoteRecord,
  recordsStorageKey,
  saveRecords,
  transitionRecordState,
} from '../../../resources/chat/chat-records.js';

function makeStorage(options: {
  initial?: Record<string, string>;
  getItemThrows?: boolean;
  setItemThrows?: boolean;
} = {}) {
  const store = new Map<string, string>(Object.entries(options.initial || {}));
  return {
    getItem(key: string) {
      if (options.getItemThrows) throw new Error('getItem failed');
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (options.setItemThrows) throw new Error('setItem failed');
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  } as unknown as Storage;
}

describe('promoteRecord', () => {
  it('prepends a normalized promoted record', () => {
    const records = [];
    const source = buildSourceRef('sess-1', 'msg-1', 'assistant', 3);
    const next = promoteRecord(records, {
      id: 'rec-1',
      type: 'decision',
      title: ' Use sqlite ',
      body: ' Keep project storage local ',
      source,
      createdAt: '2026-05-30T00:00:00Z',
    });
    expect(next[0]).toMatchObject({
      id: 'rec-1',
      type: 'decision',
      title: 'Use sqlite',
      body: 'Keep project storage local',
      state: 'extracted',
      source,
    });
  });
});

describe('transitionRecordState', () => {
  it('changes only the targeted record', () => {
    const records = [
      { id: 'a', state: 'raw' },
      { id: 'b', state: 'reviewed' },
    ];
    expect(transitionRecordState(records, 'a', 'canonical')).toEqual([
      { id: 'a', state: 'canonical' },
      { id: 'b', state: 'reviewed' },
    ]);
  });
});

describe('groupRecordsByType', () => {
  it('groups records into type buckets', () => {
    const grouped = groupRecordsByType([
      { id: '1', type: 'decision' },
      { id: '2', type: 'artifact' },
      { id: '3', type: 'decision' },
    ]);
    expect(grouped.decision).toHaveLength(2);
    expect(grouped.artifact).toHaveLength(1);
  });
});

describe('record storage helpers', () => {
  it('round-trips valid records through save and load', () => {
    const storage = makeStorage();
    const projectId = 'project-1';
    const records = [
      { id: 'a', type: 'decision', state: 'canonical' },
      { id: 'b', type: 'artifact', state: 'reviewed' },
    ];

    saveRecords(projectId, records, storage);

    expect(storage.getItem(recordsStorageKey(projectId))).toBe(JSON.stringify(records));
    expect(loadRecords(projectId, storage)).toEqual(records);
  });

  it('returns an empty list for parseable but invalid stored JSON shape', () => {
    const storage = makeStorage({ initial: { [recordsStorageKey('project-1')]: '{}' } });

    expect(loadRecords('project-1', storage)).toEqual([]);
  });

  it('swallows write failures for saveRecords', () => {
    const storage = makeStorage({ setItemThrows: true });

    expect(() => saveRecords('project-1', [{ id: 'a' }], storage)).not.toThrow();
  });
});
