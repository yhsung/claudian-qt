// Pure rewind helper logic — no globals, fully testable
export function shouldShowRewind(msg) {
  if (msg.role !== 'assistant') return false;
  const EDIT_TOOLS = ['write_file', 'replace_file_content', 'write_to_file', 'write', 'edit', 'Write', 'Edit'];
  return !!(msg.toolCalls && msg.toolCalls.some(tc => EDIT_TOOLS.includes(tc.name)));
}

export function buildRewindStatusMsg(restoredCount, failedFiles) {
  const failed = failedFiles || [];
  const restored = restoredCount || 0;
  return failed.length
    ? `Rewound ${restored} file(s). Failed: ${failed.join(', ')}`
    : `Rewound ${restored} file(s) successfully.`;
}
