import { loadRecords } from './chat-records.js';

const TRUST_TIER_BY_STATE = {
  canonical: 0,
  reviewed: 1,
  extracted: 2,
  raw: 3,
  stale: 4,
  session: 5,
};

function normalizeQuery(query) {
  return String(query || '').trim().toLowerCase();
}

function countMatches(text, query) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack || !query) return 0;

  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(query, index)) !== -1) {
    count += 1;
    index += query.length;
  }
  return count;
}

function fallbackProjectName(cwd) {
  if (!cwd) return 'Workspace';
  const leaf = String(cwd).split('/').filter(Boolean).slice(-1)[0];
  return leaf || cwd;
}

function formatTypeLabel(type) {
  return String(type || 'record')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatStateLabel(state) {
  return formatTypeLabel(state || 'raw');
}

function buildSourceLabel(source, sessionId) {
  if (source?.sessionId) {
    const role = source.role || 'note';
    const indexLabel = Number.isFinite(source.index) ? ` · #${source.index + 1}` : '';
    return `${source.sessionId} · ${role}${indexLabel}`;
  }
  if (sessionId) {
    return `${sessionId} · raw session`;
  }
  return '';
}

function recordMatchScore(record, query) {
  return (
    countMatches(record.title, query) * 4 +
    countMatches(record.body, query) * 2 +
    countMatches(record.type, query)
  );
}

export function collectRecordResults(projects, query, storage = localStorage) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return [];

  const results = [];
  for (const project of projects || []) {
    const projectRecords = loadRecords(project.id, storage);
    for (const record of projectRecords) {
      const title = String(record.title || formatTypeLabel(record.type)).trim();
      const body = String(record.body || '').trim();
      const matchScore = recordMatchScore({ title, body, type: record.type }, normalizedQuery);
      if (!matchScore) continue;

      const state = String(record.state || 'raw');
      results.push({
        id: `record:${project.id}:${record.id}`,
        kind: 'record',
        type: record.type || 'record',
        title,
        snippet: body || title,
        state,
        projectId: project.id,
        projectName: project.name || fallbackProjectName(project.cwd),
        projectCwd: project.cwd || '',
        sessionId: record.source?.sessionId || '',
        messageId: record.source?.messageId || '',
        timestamp: record.updatedAt || record.createdAt || '',
        matchScore,
        trustTier: TRUST_TIER_BY_STATE[state] ?? TRUST_TIER_BY_STATE.raw,
        source: record.source || null,
      });
    }
  }

  return results;
}

export function collectSessionResults(projects, sessions, rawHits) {
  const projectByCwd = new Map((projects || []).map((project) => [project.cwd || '', project]));
  const sessionByKey = new Map(
    (sessions || []).map((session) => [`${session.id}::${session.cwd || ''}`, session]),
  );

  return (rawHits || [])
    .filter((hit) => hit && hit.sessionId)
    .map((hit) => {
      const cwd = hit.cwd || '';
      const project = projectByCwd.get(cwd);
      const session = sessionByKey.get(`${hit.sessionId}::${cwd}`);
      return {
        id: `session:${cwd}:${hit.sessionId}`,
        kind: 'session',
        type: 'session',
        title: hit.sessionName || session?.name || hit.sessionId.slice(0, 8),
        snippet: String(hit.excerpt || '').trim(),
        state: 'raw',
        projectId: project?.id || `cwd:${cwd || '~'}`,
        projectName: project?.name || fallbackProjectName(cwd),
        projectCwd: cwd,
        sessionId: hit.sessionId,
        messageId: '',
        timestamp: hit.timestamp || session?.timestamp || '',
        matchScore: Number(hit.hitCount) || 0,
        trustTier: TRUST_TIER_BY_STATE.session,
        hitCount: Number(hit.hitCount) || 0,
        source: null,
      };
    });
}

export function rankResults(results) {
  return [...(results || [])].sort((left, right) => {
    if ((left.trustTier ?? 99) !== (right.trustTier ?? 99)) {
      return (left.trustTier ?? 99) - (right.trustTier ?? 99);
    }
    if ((left.matchScore ?? 0) !== (right.matchScore ?? 0)) {
      return (right.matchScore ?? 0) - (left.matchScore ?? 0);
    }
    if ((left.timestamp || '') !== (right.timestamp || '')) {
      return (right.timestamp || '').localeCompare(left.timestamp || '');
    }
    return String(left.title || '').localeCompare(String(right.title || ''));
  });
}

export function groupResults(results) {
  const ranked = results || [];
  const best = ranked.filter((result) => result.kind === 'record' && ['canonical', 'reviewed'].includes(result.state));
  const records = ranked.filter((result) => result.kind === 'record' && !['canonical', 'reviewed'].includes(result.state));
  const sessions = ranked.filter((result) => result.kind === 'session');
  const groups = [];

  if (best.length) groups.push({ key: 'best', label: 'Best answers', items: best });
  if (records.length) groups.push({ key: 'records', label: 'Related records', items: records });
  if (sessions.length) groups.push({ key: 'sessions', label: 'Raw session hits', items: sessions });

  return groups;
}

export function buildResultPreview(result) {
  return {
    title: result.title || '',
    snippet: result.snippet || '',
    stateLabel: formatStateLabel(result.kind === 'session' ? 'raw' : result.state),
    projectLabel: result.projectName || 'Workspace',
    sourceLabel: buildSourceLabel(result.source, result.sessionId),
    timestampLabel: result.timestamp || '',
    kindLabel: result.kind === 'session' ? 'Raw session hit' : formatTypeLabel(result.type),
  };
}
