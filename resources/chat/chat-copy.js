// Pure copy-content helpers — no DOM, no globals
export function buildMsgCopyText(msg) {
  return msg.content || '';
}

export function buildToolGroupCopyText(toolCalls) {
  return toolCalls
    .map(tc => `=== ${tc.name || 'tool'} ===\n${tc.result || ''}`)
    .join('\n\n');
}
