import { describe, it, expect } from 'vitest';
import {
  buildSourceRef,
  groupRecordsByType,
  promoteRecord,
  transitionRecordState,
} from '../../../resources/chat/chat-records.js';

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
