import { describe, it, expect } from 'vitest';
import {
  createDefaultProject,
  defaultProjectId,
  ensureProjectForCwd,
  buildProjectSummary,
} from '../../../resources/chat/chat-projects.js';

describe('defaultProjectId', () => {
  it('keys projects by cwd', () => {
    expect(defaultProjectId('/tmp/demo')).toBe('cwd:/tmp/demo');
  });
});

describe('ensureProjectForCwd', () => {
  it('creates a default project when none exists', () => {
    const result = ensureProjectForCwd([], '/tmp/demo');
    expect(result.projects).toHaveLength(1);
    expect(result.project.id).toBe('cwd:/tmp/demo');
  });

  it('reuses an existing project for the same cwd', () => {
    const existing = createDefaultProject('/tmp/demo');
    const result = ensureProjectForCwd([existing], '/tmp/demo');
    expect(result.projects).toHaveLength(1);
    expect(result.project).toBe(existing);
  });
});

describe('buildProjectSummary', () => {
  it('counts sessions and canonical records for one project', () => {
    const project = createDefaultProject('/tmp/demo');
    const sessions = [
      { id: 'a', cwd: '/tmp/demo' },
      { id: 'b', cwd: '/tmp/demo', exportedAt: '2026-05-30T00:00:00Z' },
      { id: 'c', cwd: '/tmp/other' },
    ];
    const records = [
      { id: 'r1', state: 'canonical' },
      { id: 'r2', state: 'raw' },
      { id: 'r3', state: 'stale' },
    ];
    expect(buildProjectSummary(project, sessions, records)).toEqual({
      sessionCount: 2,
      exportedCount: 1,
      recordCount: 3,
      canonicalCount: 1,
      staleCount: 1,
    });
  });
});
