export const PROJECTS_KEY = 'claudian:projects:v1';
export const ACTIVE_PROJECT_KEY = 'claudian:active-project:v1';

export function defaultProjectId(cwd) {
  return `cwd:${cwd || '~'}`;
}

export function createDefaultProject(cwd) {
  const id = defaultProjectId(cwd);
  return {
    id,
    name: cwd ? cwd.split('/').filter(Boolean).slice(-1)[0] || cwd : 'Workspace',
    cwd: cwd || '',
    sections: ['inbox', 'worklog', 'decisions', 'artifacts', 'questions', 'people'],
    createdAt: new Date(0).toISOString(),
    pinnedSessionIds: [],
  };
}

export function loadProjects(storage = localStorage) {
  try {
    const raw = storage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects, storage = localStorage) {
  storage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function ensureProjectForCwd(projects, cwd) {
  const id = defaultProjectId(cwd);
  const existing = projects.find(p => p.id === id);
  if (existing) return { projects, project: existing };
  const next = [...projects, createDefaultProject(cwd)];
  return { projects: next, project: next[next.length - 1] };
}

export function loadActiveProjectId(storage = localStorage) {
  return storage.getItem(ACTIVE_PROJECT_KEY) || '';
}

export function saveActiveProjectId(projectId, storage = localStorage) {
  storage.setItem(ACTIVE_PROJECT_KEY, projectId);
}

export function buildProjectSummary(project, sessions, records) {
  const projectSessions = sessions.filter(s => (s.cwd || '') === (project.cwd || ''));
  return {
    sessionCount: projectSessions.length,
    exportedCount: projectSessions.filter(s => s.exportedAt).length,
    recordCount: records.length,
    canonicalCount: records.filter(r => r.state === 'canonical').length,
    staleCount: records.filter(r => r.state === 'stale').length,
  };
}
