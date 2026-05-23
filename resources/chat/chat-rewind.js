// Pure rewind helper logic — no globals, fully testable
export function shouldShowRewind(msg) {
  if (msg.role !== 'assistant') return false;
  return !!(msg.toolCalls && msg.toolCalls.some(tc => tc.name === 'write_file' || tc.name === 'replace_file_content'));
}

export function buildRewindStatusMsg(restoredCount, failedFiles) {
  const failed = failedFiles || [];
  const restored = restoredCount || 0;
  return failed.length
    ? `Rewound ${restored} file(s). Failed: ${failed.join(', ')}`
    : `Rewound ${restored} file(s) successfully.`;
}
