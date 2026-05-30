import { describe, it, expect } from 'vitest';
import {
  createDefaultProject,
  defaultProjectId,
  ensureProjectForCwd,
  buildProjectSummary,
  loadActiveProjectId,
  loadProjects,
  saveActiveProjectId,
  saveProjects,
  PROJECTS_KEY,
} from '../../../resources/chat/chat-projects.js';

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
    dump() {
      return Object.fromEntries(store.entries());
    },
  } as unknown as Storage & { dump: () => Record<string, string> };
}

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

describe('project storage helpers', () => {
  it('loads and saves projects round-trip', () => {
    const storage = makeStorage();
    const projects = [createDefaultProject('/tmp/demo')];

    saveProjects(projects, storage);

    expect(storage.getItem(PROJECTS_KEY)).toBe(JSON.stringify(projects));
    expect(loadProjects(storage)).toEqual(projects);
  });

  it('returns an empty list for parseable invalid stored JSON shape', () => {
    const storage = makeStorage({ initial: { [PROJECTS_KEY]: '{}' } });
    expect(loadProjects(storage)).toEqual([]);
  });

  it('returns an empty active project id when storage getItem throws', () => {
    const storage = makeStorage({ getItemThrows: true });
    expect(loadActiveProjectId(storage)).toBe('');
  });

  it('swallows write failures for save helpers', () => {
    const storage = makeStorage({ setItemThrows: true });

    expect(() => saveProjects([createDefaultProject('/tmp/demo')], storage)).not.toThrow();
    expect(() => saveActiveProjectId('project-1', storage)).not.toThrow();
  });
});
