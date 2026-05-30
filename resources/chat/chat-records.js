export const RECORD_STATES = ['raw', 'extracted', 'reviewed', 'canonical', 'stale'];

export function recordsStorageKey(projectId) {
  return `claudian:records:${projectId}`;
}

export function loadRecords(projectId, storage = localStorage) {
  try {
    const raw = storage.getItem(recordsStorageKey(projectId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecords(projectId, records, storage = localStorage) {
  storage.setItem(recordsStorageKey(projectId), JSON.stringify(records));
}

export function buildSourceRef(sessionId, messageId, role, index) {
  return { sessionId, messageId, role, index };
}

export function promoteRecord(records, draft) {
  const record = {
    id: draft.id,
    type: draft.type,
    title: draft.title.trim(),
    body: draft.body.trim(),
    state: draft.state || 'extracted',
    source: draft.source,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt || draft.createdAt,
  };
  return [record, ...records.filter(r => r.id !== record.id)];
}

export function transitionRecordState(records, recordId, nextState) {
  if (!RECORD_STATES.includes(nextState)) return records;
  return records.map(r => (r.id === recordId ? { ...r, state: nextState } : r));
}

export function groupRecordsByType(records) {
  return records.reduce((acc, record) => {
    (acc[record.type] ||= []).push(record);
    return acc;
  }, {});
}
