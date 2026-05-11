import { describe, it, expect } from 'vitest';
import { buildMsgCopyText, buildToolGroupCopyText } from '../../../resources/chat/chat-copy.js';

describe('buildMsgCopyText', () => {
  it('returns message content', () => {
    expect(buildMsgCopyText({ content: 'hello world', role: 'user' })).toBe('hello world');
  });

  it('returns empty string when content is undefined', () => {
    expect(buildMsgCopyText({ role: 'assistant' })).toBe('');
  });

  it('returns empty string when content is null', () => {
    expect(buildMsgCopyText({ content: null })).toBe('');
  });
});

describe('buildToolGroupCopyText', () => {
  it('formats single tool result with header', () => {
    const result = buildToolGroupCopyText([{ name: 'bash', result: 'ok' }]);
    expect(result).toBe('=== bash ===\nok');
  });

  it('joins multiple tools with double newline', () => {
    const result = buildToolGroupCopyText([
      { name: 'bash', result: 'first' },
      { name: 'read_file', result: 'second' },
    ]);
    expect(result).toBe('=== bash ===\nfirst\n\n=== read_file ===\nsecond');
  });

  it('uses "tool" as fallback name when name is missing', () => {
    const result = buildToolGroupCopyText([{ result: 'data' }]);
    expect(result).toBe('=== tool ===\ndata');
  });

  it('uses empty string for missing result', () => {
    const result = buildToolGroupCopyText([{ name: 'bash' }]);
    expect(result).toBe('=== bash ===\n');
  });

  it('returns empty string for empty array', () => {
    expect(buildToolGroupCopyText([])).toBe('');
  });
});
