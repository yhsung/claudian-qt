import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../../../resources/chat/chat-projects.js';
import { recordsStorageKey } from '../../../resources/chat/chat-records.js';
import {
  buildResultPreview,
  collectRecordResults,
  collectSessionResults,
  groupResults,
  rankResults,
} from '../../../resources/chat/chat-retrieval.js';

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

describe('collectRecordResults', () => {
  it('returns canonical and reviewed matches across projects', () => {
    const alpha = createDefaultProject('/tmp/alpha');
    const beta = createDefaultProject('/tmp/beta');
    const storage = makeStorage({
      [recordsStorageKey(alpha.id)]: JSON.stringify([
        {
          id: 'rec-1',
          type: 'decision',
          title: 'Adopt shared cache key',
          body: 'Use the sapphire cache path',
          state: 'canonical',
          createdAt: '2026-05-31T00:00:00Z',
          source: { sessionId: 'sess-a', messageId: 'msg-a', role: 'assistant', index: 1 },
        },
      ]),
      [recordsStorageKey(beta.id)]: JSON.stringify([
        {
          id: 'rec-2',
          type: 'artifact',
          title: 'Cache migration notes',
          body: 'Sapphire rollout notes',
          state: 'reviewed',
          createdAt: '2026-05-30T00:00:00Z',
          source: { sessionId: 'sess-b', messageId: 'msg-b', role: 'user', index: 0 },
        },
      ]),
    });

    const results = collectRecordResults([alpha, beta], 'sapphire', storage);

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.projectName)).toEqual(['alpha', 'beta']);
    expect(results[0].state).toBe('canonical');
    expect(results[1].state).toBe('reviewed');
  });
});

describe('collectSessionResults', () => {
  it('normalizes raw session hits with project metadata', () => {
    const alpha = createDefaultProject('/tmp/alpha');

    const results = collectSessionResults(
      [alpha],
      [],
      [
        {
          sessionId: 'sess-a',
          sessionName: 'Sapphire session',
          excerpt: 'Discuss the sapphire cache path',
          hitCount: 3,
          cwd: '/tmp/alpha',
          timestamp: '2026-05-29T00:00:00Z',
        },
      ],
    );

    expect(results).toEqual([
      expect.objectContaining({
        kind: 'session',
        sessionId: 'sess-a',
        title: 'Sapphire session',
        projectId: alpha.id,
        projectName: 'alpha',
        matchScore: 3,
        timestamp: '2026-05-29T00:00:00Z',
      }),
    ]);
  });
});

describe('rankResults', () => {
  it('ranks canonical records above raw session hits', () => {
    const ranked = rankResults([
      {
        id: 'session:sess-a',
        kind: 'session',
        title: 'Raw session',
        snippet: 'sapphire trace',
        state: 'raw',
        projectId: 'project-a',
        projectName: 'alpha',
        projectCwd: '/tmp/alpha',
        sessionId: 'sess-a',
        timestamp: '2026-05-31T00:00:00Z',
        matchScore: 9,
        trustTier: 5,
      },
      {
        id: 'record:rec-a',
        kind: 'record',
        title: 'Canonical decision',
        snippet: 'sapphire final answer',
        state: 'canonical',
        type: 'decision',
        projectId: 'project-b',
        projectName: 'beta',
        projectCwd: '/tmp/beta',
        sessionId: 'sess-b',
        timestamp: '2026-05-30T00:00:00Z',
        matchScore: 1,
        trustTier: 0,
      },
    ]);

    expect(ranked[0].id).toBe('record:rec-a');
    expect(ranked[1].id).toBe('session:sess-a');
  });

  it('breaks ties within a trust tier by match score then recency', () => {
    const ranked = rankResults([
      {
        id: 'record:older',
        kind: 'record',
        title: 'Reviewed note',
        snippet: 'sapphire',
        state: 'reviewed',
        type: 'artifact',
        projectId: 'project-a',
        projectName: 'alpha',
        projectCwd: '/tmp/alpha',
        timestamp: '2026-05-30T00:00:00Z',
        matchScore: 2,
        trustTier: 1,
      },
      {
        id: 'record:newer',
        kind: 'record',
        title: 'Reviewed note newer',
        snippet: 'sapphire',
        state: 'reviewed',
        type: 'artifact',
        projectId: 'project-a',
        projectName: 'alpha',
        projectCwd: '/tmp/alpha',
        timestamp: '2026-05-31T00:00:00Z',
        matchScore: 2,
        trustTier: 1,
      },
      {
        id: 'record:stronger',
        kind: 'record',
        title: 'Reviewed note stronger',
        snippet: 'sapphire sapphire',
        state: 'reviewed',
        type: 'artifact',
        projectId: 'project-a',
        projectName: 'alpha',
        projectCwd: '/tmp/alpha',
        timestamp: '2026-05-01T00:00:00Z',
        matchScore: 4,
        trustTier: 1,
      },
    ]);

    expect(ranked.map((result) => result.id)).toEqual([
      'record:stronger',
      'record:newer',
      'record:older',
    ]);
  });
});

describe('groupResults', () => {
  it('groups best answers, related records, and raw session hits separately', () => {
    const groups = groupResults([
      { id: 'a', kind: 'record', state: 'canonical', trustTier: 0 },
      { id: 'b', kind: 'record', state: 'reviewed', trustTier: 1 },
      { id: 'c', kind: 'record', state: 'extracted', trustTier: 2 },
      { id: 'd', kind: 'session', state: 'raw', trustTier: 5 },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({ key: 'best', label: 'Best answers', items: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })] }),
      expect.objectContaining({ key: 'records', label: 'Related records', items: [expect.objectContaining({ id: 'c' })] }),
      expect.objectContaining({ key: 'sessions', label: 'Raw session hits', items: [expect.objectContaining({ id: 'd' })] }),
    ]);
  });
});

describe('buildResultPreview', () => {
  it('includes trust and provenance metadata for record results', () => {
    const preview = buildResultPreview({
      id: 'record:rec-1',
      kind: 'record',
      title: 'Canonical decision',
      snippet: 'Use the sapphire cache path',
      state: 'canonical',
      type: 'decision',
      projectId: 'project-a',
      projectName: 'alpha',
      projectCwd: '/tmp/alpha',
      sessionId: 'sess-a',
      messageId: 'msg-a',
      timestamp: '2026-05-31T00:00:00Z',
      matchScore: 4,
      trustTier: 0,
      source: { sessionId: 'sess-a', messageId: 'msg-a', role: 'assistant', index: 2 },
    });

    expect(preview).toEqual(
      expect.objectContaining({
        title: 'Canonical decision',
        stateLabel: 'Canonical',
        projectLabel: 'alpha',
        sourceLabel: 'sess-a · assistant · #3',
        snippet: 'Use the sapphire cache path',
      }),
    );
  });
});
