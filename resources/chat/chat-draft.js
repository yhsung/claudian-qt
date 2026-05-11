// Pure draft persistence logic — no globals, fully testable
export function saveDraft(sessionId, value, storage = sessionStorage) {
  const key = `draft:${sessionId || 'draft'}`;
  if (value.trim()) storage.setItem(key, value);
  else storage.removeItem(key);
}

export function restoreDraft(sessionId, storage = sessionStorage) {
  return storage.getItem(`draft:${sessionId || 'draft'}`);
}

export function clearDraft(sessionId, storage = sessionStorage) {
  storage.removeItem(`draft:${sessionId || 'draft'}`);
}
