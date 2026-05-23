import { describe, it, expect, vi } from 'vitest';
import { shouldShowRewind, buildRewindStatusMsg } from '../../../resources/chat/chat-rewind.js';

describe('shouldShowRewind', () => {
  it('returns false for user messages', () => {
    const msg = { role: 'user', content: 'hello' };
    expect(shouldShowRewind(msg)).toBe(false);
  });

  it('returns false for assistant messages with no tool calls', () => {
    const msg = { role: 'assistant', content: 'hello' };
    expect(shouldShowRewind(msg)).toBe(false);
  });

  it('returns false for assistant messages with non-file-editing tool calls', () => {
    const msg = {
      role: 'assistant',
      toolCalls: [
        { name: 'read_file', inputJson: '{}' },
        { name: 'list_dir', inputJson: '{}' }
      ]
    };
    expect(shouldShowRewind(msg)).toBe(false);
  });

  it('returns true for assistant messages containing write_file tool call', () => {
    const msg = {
      role: 'assistant',
      toolCalls: [
        { name: 'read_file', inputJson: '{}' },
        { name: 'write_file', inputJson: '{"path": "foo.txt"}' }
      ]
    };
    expect(shouldShowRewind(msg)).toBe(true);
  });

  it('returns true for assistant messages containing replace_file_content tool call', () => {
    const msg = {
      role: 'assistant',
      toolCalls: [
        { name: 'replace_file_content', inputJson: '{"path": "foo.txt"}' }
      ]
    };
    expect(shouldShowRewind(msg)).toBe(true);
  });

  it('returns true for assistant messages containing Write tool call', () => {
    const msg = {
      role: 'assistant',
      toolCalls: [
        { name: 'Write', inputJson: '{"file_path": "foo.txt"}' }
      ]
    };
    expect(shouldShowRewind(msg)).toBe(true);
  });

  it('returns true for assistant messages containing Edit tool call', () => {
    const msg = {
      role: 'assistant',
      toolCalls: [
        { name: 'Edit', inputJson: '{"file_path": "foo.txt"}' }
      ]
    };
    expect(shouldShowRewind(msg)).toBe(true);
  });
});

describe('buildRewindStatusMsg', () => {
  it('builds successful message for 0 failed files', () => {
    expect(buildRewindStatusMsg(3, [])).toBe('Rewound 3 file(s) successfully.');
  });

  it('builds successful message when failedFiles is undefined', () => {
    expect(buildRewindStatusMsg(1, undefined)).toBe('Rewound 1 file(s) successfully.');
  });

  it('builds failure message listing failed files', () => {
    const msg = buildRewindStatusMsg(2, ['src/main.cpp', 'resources/chat.js']);
    expect(msg).toBe('Rewound 2 file(s). Failed: src/main.cpp, resources/chat.js');
  });
});

// Interactive GUI State Simulation Tests
describe('GUI Interactivity Simulation', () => {
  it('triggers the correct IPC command and disables button when clicked', () => {
    const mockBridge = {
      rewindFiles: vi.fn(),
    };

    const msg = {
      userMessageId: 'user-msg-uuid-123'
    };

    // Simulate DOM elements and events
    const button = {
      disabled: false,
      textContent: 'Undo Changes',
      clickHandlers: [] as Function[],
      addEventListener(event: string, handler: Function) {
        if (event === 'click') this.clickHandlers.push(handler);
      },
      click(e: any) {
        this.clickHandlers.forEach(h => h(e));
      }
    };

    const stopPropagation = vi.fn();
    const mockEvent = { stopPropagation };

    // Register click event handler like in chat.js
    button.addEventListener('click', (e: any) => {
      e.stopPropagation();
      if (!msg.userMessageId) return;
      button.disabled = true;
      button.textContent = 'Undoing...';
      mockBridge.rewindFiles(msg.userMessageId, false);
    });

    // Fire the click action
    button.click(mockEvent);

    expect(stopPropagation).toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Undoing...');
    expect(mockBridge.rewindFiles).toHaveBeenCalledWith('user-msg-uuid-123', false);
  });

  it('updates classes and content correctly on rewind results', () => {
    const failedFiles: string[] = [];
    const restoredCount = 3;

    // Simulate DOM element list
    const buttons = [
      {
        title: 'Undoing changes...',
        className: 'msg-action-btn rewind-btn',
        disabled: true,
        classList: new Set<string>(['undoing']),
      }
    ];

    // Simulate rewindResult callback dispatch
    const failed = failedFiles;
    const msg = buildRewindStatusMsg(restoredCount, failed);

    expect(msg).toBe('Rewound 3 file(s) successfully.');

    // Process buttons like in chat.js
    buttons.forEach(btn => {
      if (btn.classList.has('undoing')) {
        btn.classList.delete('undoing');
        btn.disabled = false;
        btn.title = 'Undo file changes made in this turn';
        if (failed.length === 0) {
          btn.classList.add('undone');
        }
      }
    });

    expect(buttons[0].classList.has('undoing')).toBe(false);
    expect(buttons[0].classList.has('undone')).toBe(true);
    expect(buttons[0].disabled).toBe(false);
  });
});
