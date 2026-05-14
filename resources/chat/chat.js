import {
  saveDraft as _saveDraft,
  restoreDraft as _restoreDraft,
  clearDraft as _clearDraft,
} from './chat-draft.js';
import { computeUserScrolled, shouldAutoScroll } from './chat-scroll.js';
import { navigateUp, navigateDown } from './chat-nav.js';
import { buildMsgCopyText, buildToolGroupCopyText } from './chat-copy.js';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  messages: [],
  streaming: false,
  currentMsgId: null,
  sessions: [],
  activeSessionId: '',
  cwd: '',
  model: '',
  yolo: false,
  permissionMode: localStorage.getItem('permissionMode') || 'default',
  viewMode: localStorage.getItem('viewMode') || 'normal',
  fontSize: localStorage.getItem('fontSize') || 'md',
  summaryData: null,
  tokenCount: 0,
  toolCallCount: 0,
  _rafPending: false,
  _streamBuffer: '',
  _userScrolled: false,
  _thinkingBuffer: '',
  _summaryCapturing: false,
  _lastPrompt: null,
  _focusedMsgIdx: -1,
  pendingAttachments: [],
  previewAttachment: null,
};

let bridge = null;
let DOM = {};
const pendingImports = new Map();

// ── Helpers ────────────────────────────────────────────────────────────────
function mkId() {
  return String(Date.now()) + String(Math.random()).slice(2, 8);
}
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

// ── Attachment helpers ─────────────────────────────────────────────────────
function renderAttachmentRow(attachments, { removable = false } = {}) {
  const row = document.createElement('div');
  row.className = 'history-attachment-row';
  attachments.forEach(att => {
    const tile = document.createElement('div');
    tile.className = 'attachment-tile';
    const img = document.createElement('img');
    img.className = removable ? 'attachment-thumb' : 'history-attachment-thumb';
    img.src = att.fileUrl;
    img.alt = att.originalName;
    img.addEventListener('click', () => openImagePreview(att));
    tile.appendChild(img);
    if (removable) {
      const rmBtn = document.createElement('button');
      rmBtn.className = 'attachment-remove';
      rmBtn.textContent = '×';
      rmBtn.title = 'Remove';
      rmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.pendingAttachments = state.pendingAttachments.filter(a => a.id !== att.id);
        renderPendingAttachments();
      });
      tile.appendChild(rmBtn);
    }
    row.appendChild(tile);
  });
  return row;
}

function renderPendingAttachments() {
  DOM.attachmentTray.innerHTML = '';
  DOM.attachmentTray.classList.toggle('visible', state.pendingAttachments.length > 0);
  if (state.pendingAttachments.length > 0) {
    DOM.attachmentTray.appendChild(renderAttachmentRow(state.pendingAttachments, { removable: true }));
    if (state.pendingAttachments.length > 1) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'attachment-clear-all';
      clearBtn.textContent = 'Clear all';
      clearBtn.addEventListener('click', () => {
        state.pendingAttachments = [];
        renderPendingAttachments();
      });
      DOM.attachmentTray.appendChild(clearBtn);
    }
  }
}

function openImagePreview(att) {
  state.previewAttachment = att;
  DOM.imagePreviewImg.src = att.fileUrl;
  DOM.imagePreviewImg.alt = att.originalName;
  DOM.imagePreviewCaption.textContent = att.originalName;
  DOM.imagePreviewModal.classList.add('visible');
}

function normalizeAttachment(raw) {
  return {
    id: raw.id,
    originalName: raw.originalName,
    mimeType: raw.mimeType,
    stagedPath: raw.stagedPath || '',
    fileUrl: raw.fileUrl,
    sizeBytes: raw.sizeBytes,
    width: raw.width ?? null,
    height: raw.height ?? null,
  };
}

async function importClipboardFile(file) {
  return new Promise((resolve, reject) => {
    const requestId = mkId();
    const reader = new FileReader();

    const timeout = setTimeout(() => {
      if (!pendingImports.has(requestId)) return;
      pendingImports.delete(requestId);
      reject(new Error('Image import timed out: ' + (file.name || 'clipboard-image.png')));
    }, 15000);

    pendingImports.set(requestId, {
      resolve(att) { clearTimeout(timeout); resolve(att); },
      reject(err)  { clearTimeout(timeout); reject(err); },
    });

    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] || '';
      bridge.importImageData(requestId, file.name || 'clipboard-image.png', file.type || 'image/png', base64);
    };
    reader.onerror = () => {
      clearTimeout(timeout);
      pendingImports.delete(requestId);
      reject(reader.error);
    };
    reader.readAsDataURL(file);
  });
}

// ── Permission state ───────────────────────────────────────────────────────
let _pendingPermissionRequestId = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
function initDOM() {
  DOM = {
    sessionList:        document.getElementById('session-list'),
    newSessionBtn:      document.getElementById('new-session-btn'),
    messages:           document.getElementById('messages'),
    typingIndicator:    document.getElementById('typing-indicator'),
    typingLabel:        document.querySelector('.typing-label'),
    summaryView:        document.getElementById('summary-view'),
    summaryStats:       document.getElementById('summary-stats'),
    summaryLastTurn:    document.getElementById('summary-last-turn'),
    summaryContent:     document.getElementById('summary-content'),
    generateSummaryBtn: document.getElementById('generate-summary-btn'),
    exitSummaryBtn:     document.getElementById('exit-summary-btn'),
    inputArea:          document.getElementById('input-area'),
    textarea:           document.getElementById('input-textarea'),
    sendBtn:            document.getElementById('send-btn'),
    stopBtn:            document.getElementById('stop-btn'),
    cwdBtn:             document.getElementById('cwd-btn'),
    modelBtn:           document.getElementById('model-btn'),
    modelBtnLabel:      document.getElementById('model-btn-label'),
    modelDropdown:      document.getElementById('model-dropdown'),
    permModeBtn:        document.getElementById('perm-mode-btn'),
    yoloBtn:            document.getElementById('yolo-btn'),
    sidebarToggle:      document.getElementById('sidebar-toggle'),
    searchBtn:          document.getElementById('search-btn'),
    searchBar:          document.getElementById('search-bar'),
    searchInput:        document.getElementById('search-input'),
    searchCount:        document.getElementById('search-count'),
    searchPrev:         document.getElementById('search-prev'),
    searchNext:         document.getElementById('search-next'),
    searchClose:        document.getElementById('search-close'),
    exportBtn:          document.getElementById('export-btn'),
    viewSelectorBtn:    document.getElementById('view-selector-btn'),
    viewSelectorLabel:  document.getElementById('view-selector-label'),
    viewPopup:          document.getElementById('view-popup'),
    attachmentTray:     document.getElementById('attachment-tray'),
    attachBtn:          document.getElementById('attach-btn'),
    imagePreviewModal:  document.getElementById('image-preview-modal'),
    imagePreviewImg:    document.getElementById('image-preview-img'),
    imagePreviewCaption: document.getElementById('image-preview-caption'),
    imagePreviewClose:    document.getElementById('image-preview-close'),
    statuslineModel:      document.getElementById('statusline-model'),
    statuslineFastMode: document.getElementById('statusline-fast-mode'),
    statuslineBarTrack:   document.getElementById('statusline-bar-track'),
    statuslineBarFill:    document.getElementById('statusline-bar-fill'),
    statuslinePct:        document.getElementById('statusline-pct'),
    statuslineTurns:      document.getElementById('statusline-turns'),
    permissionModal:      document.getElementById('permission-modal'),
    permissionToolName:   document.getElementById('permission-tool-name'),
    permissionTitle:      document.getElementById('permission-title'),
    permissionDesc:       document.getElementById('permission-description'),
    permissionBlockedPath: document.getElementById('permission-blocked-path'),
    permissionDenyBtn:    document.getElementById('permission-deny-btn'),
    permissionAllowBtn:   document.getElementById('permission-allow-btn'),
    permissionSessionBtn: document.getElementById('permission-session-btn'),
    permissionAlwaysBtn:  document.getElementById('permission-always-btn'),
    scrollToBottomBtn:    document.getElementById('scroll-to-bottom'),
    rateLimitBanner:      document.getElementById('rate-limit-banner'),
    rateLimitText:        document.getElementById('rate-limit-text'),
    thinkingSelect:       document.getElementById('thinking-select'),
    runOptsToggle:        document.getElementById('run-opts-toggle'),
    runOptionsRow:        document.getElementById('run-options-row'),
    systemPromptRow:      document.getElementById('system-prompt-row'),
    maxTurnsInput:        document.getElementById('max-turns-input'),
    maxBudgetInput:       document.getElementById('max-budget-input'),
    effortSelect:         document.getElementById('effort-select'),
    systemPromptInput:    document.getElementById('system-prompt-input'),
    applyRunOptsBtn:      document.getElementById('apply-run-options-btn'),
    toolControlsRow:      document.getElementById('tool-controls-row'),
    allowedToolsInput:    document.getElementById('allowed-tools-input'),
    disallowedToolsInput: document.getElementById('disallowed-tools-input'),
    applyToolControlsBtn: document.getElementById('apply-tool-controls-btn'),
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────
function makeToolResultEl(content, isError) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tool-result-wrapper';
  const pre = document.createElement('pre');
  pre.className = `tool-result${isError ? ' tool-result-error' : ''}`;
  pre.textContent = content;
  const btn = document.createElement('button');
  btn.className = 'tool-result-copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', () => {
    copyToClipboard(content);
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
  });
  wrapper.append(pre, btn);
  return wrapper;
}

function renderToolCallItem(tc) {
  const div = document.createElement('div');
  div.className = 'tool-call-item';
  if (tc.id) div.dataset.toolId = tc.id;
  const inputStr = (() => {
    try { return JSON.stringify(JSON.parse(tc.inputJson), null, 2); }
    catch { return tc.inputJson; }
  })();
  const elapsedStr = tc.elapsedSeconds != null ? ` (${tc.elapsedSeconds.toFixed(1)}s)` : '';
  const statusText = tc.status === 'running'
    ? `⏳ running${elapsedStr}`
    : tc.status === 'done'
      ? `✓ done${elapsedStr}`
      : `✗ error${elapsedStr}`;
  div.innerHTML =
    `<div class="tool-name">${escHtml(tc.name)}</div>` +
    (state.viewMode === 'verbose'
      ? `<div class="tool-input">${escHtml(inputStr)}</div>`
      : '') +
    `<div class="tool-status ${tc.status}">${statusText}</div>`;
  if (tc.result !== undefined) div.appendChild(makeToolResultEl(tc.result, tc.isError));
  return div;
}

function makeToolGroupCopyBtn(toolCalls) {
  const btn = document.createElement('button');
  btn.className = 'tool-group-copy-btn';
  btn.textContent = 'Copy all results';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(buildToolGroupCopyText(toolCalls));
    showToast('Copied all results');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy all results'; }, 1500);
  });
  return btn;
}

function renderToolCalls(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return null;
  const group = document.createElement('div');
  group.className = 'tool-group';
  const header = document.createElement('div');
  header.className = 'tool-group-header';
  header.innerHTML =
    `<span class="tool-group-arrow">▶</span>` +
    `<span class="tool-group-label">Ran ${toolCalls.length} command${toolCalls.length > 1 ? 's' : ''}</span>`;
  header.addEventListener('click', () => group.classList.toggle('expanded'));
  const body = document.createElement('div');
  body.className = 'tool-group-body';
  toolCalls.forEach(tc => body.appendChild(renderToolCallItem(tc)));
  const copyAllBtn = makeToolGroupCopyBtn(toolCalls);
  body.appendChild(copyAllBtn);
  group.append(header, body);
  return group;
}

// ── Message copy ─────────────────────────────────────────────────────────────
function copyMsgContent(msg, btnEl) {
  copyToClipboard(buildMsgCopyText(msg));
  showToast('Copied!');
  const original = btnEl.innerHTML;
  btnEl.innerHTML = '✓';
  setTimeout(() => { btnEl.innerHTML = original; }, 1500);
}

function renderMessage(msg) {
  const outer = document.createElement('div');
  outer.dataset.msgId = msg.id;
  if (msg.role === 'user') {
    outer.className = 'msg-user';
    outer.style.flexDirection = 'column';
    outer.style.alignItems = 'flex-end';
    if (msg.attachments && msg.attachments.length > 0) {
      outer.appendChild(renderAttachmentRow(msg.attachments));
    }
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.content;
    outer.appendChild(bubble);
    // Copy button (user messages)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyMsgContent(msg, copyBtn); });
    outer.appendChild(copyBtn);
    if (msg.timestamp) {
      const ts = document.createElement('div');
      ts.className = 'msg-timestamp';
      ts.textContent = relativeTime(msg.timestamp);
      outer.appendChild(ts);
    }
  } else {
    outer.className = 'msg-assistant';
    if (msg.thinking) {
      outer.appendChild(makeThinkingBlock(msg.thinking, state.viewMode === 'thinking'));
    }
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    if (msg.content) {
      contentDiv.innerHTML = window.marked.parse(msg.content);
      postProcessCodeBlocks(contentDiv);
    }
    outer.appendChild(contentDiv);
    // Copy button (assistant messages)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyMsgContent(msg, copyBtn); });
    outer.appendChild(copyBtn);
    if (msg.toolCalls && msg.toolCalls.length > 0 && state.viewMode !== 'summary') {
      const toolEl = renderToolCalls(msg.toolCalls);
      if (toolEl) outer.appendChild(toolEl);
    }
    if (msg.timestamp) {
      const ts = document.createElement('div');
      ts.className = 'msg-timestamp';
      ts.textContent = relativeTime(msg.timestamp);
      outer.appendChild(ts);
    }
  }
  return outer;
}

function renderMessages() {
  if (state.viewMode === 'summary') { showSummaryView(); return; }
  hideSummaryView();
  clearFocusedMsg();
  DOM.messages.innerHTML = '';
  state.messages.forEach(msg => DOM.messages.appendChild(renderMessage(msg)));
  applyFontSize();
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
  state._userScrolled = false;
  DOM.messages.addEventListener('scroll', onUserScroll, { passive: true });
}

// ── Message focus ────────────────────────────────────────────────────────────
function clearFocusedMsg() {
  state._focusedMsgIdx = -1;
  DOM.messages.querySelectorAll('.msg-focused').forEach(el => el.classList.remove('msg-focused'));
}

function focusMsgByIdx(idx) {
  if (!state.messages.length) return;
  idx = Math.max(0, Math.min(idx, state.messages.length - 1));
  clearFocusedMsg();
  state._focusedMsgIdx = idx;
  const msg = state.messages[idx];
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${msg.id}"]`);
  if (msgEl) {
    msgEl.classList.add('msg-focused');
    msgEl.scrollIntoView({ block: 'nearest' });
  }
}

function onUserScroll() {
  if (!state.currentMsgId) return;
  const { scrollTop, scrollHeight, clientHeight } = DOM.messages;
  state._userScrolled = computeUserScrolled(scrollTop, scrollHeight, clientHeight);
  if (DOM.scrollToBottomBtn) {
    DOM.scrollToBottomBtn.classList.toggle('visible', state._userScrolled);
  }
}

// ── Thinking block helpers ─────────────────────────────────────────────────
function makeThinkingBlock(text, expanded) {
  const block = document.createElement('div');
  block.className = 'thinking-block' + (expanded ? ' expanded' : '');
  const header = document.createElement('div');
  header.className = 'thinking-header';
  header.innerHTML = '<span class="thinking-arrow">▶</span><span class="thinking-label">Thinking</span>';
  header.addEventListener('click', () => block.classList.toggle('expanded'));
  const body = document.createElement('div');
  body.className = 'thinking-body';
  body.textContent = text;
  block.append(header, body);
  return block;
}

function appendThinkingChunk(text) {
  state._thinkingBuffer += text;
  if (!state.currentMsgId) return;
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
  if (!msgEl) return;
  let block = msgEl.querySelector('.thinking-block');
  if (!block) {
    block = makeThinkingBlock('', state.viewMode === 'thinking');
    const contentDiv = msgEl.querySelector('.msg-content');
    msgEl.insertBefore(block, contentDiv);
  }
  const body = block.querySelector('.thinking-body');
  if (body) body.textContent = state._thinkingBuffer;
}

// ── Code block copy buttons ────────────────────────────────────────────────
function copyToClipboard(text) {
  console.log('[copyToClipboard] text length:', text.length, 'first 50:', text.slice(0, 50));
  navigator.clipboard.writeText(text).then(() => {
    console.log('[copyToClipboard] success');
  }).catch(err => {
    console.error('[copyToClipboard] clipboard API failed:', err);
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      const ok = document.execCommand('copy');
      console.log('[copyToClipboard] execCommand result:', ok);
    } catch(e) {
      console.error('[copyToClipboard] execCommand failed:', e);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

// ── Toast helper ────────────────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function postProcessCodeBlocks(el) {
  el.querySelectorAll('pre:not(.code-wrapped)').forEach(pre => {
    pre.classList.add('code-wrapped');
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const text = pre.textContent || '';
      bridge.copyToClipboard(text);
      showToast(text ? 'Copied!' : 'Nothing to copy');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
    });
    wrapper.appendChild(btn);
  });
}

// ── Streaming ──────────────────────────────────────────────────────────────
function flushStreamBuffer() {
  state._rafPending = false;
  if (!state.currentMsgId) return;
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
  if (!msgEl) return;
  const contentDiv = msgEl.querySelector('.msg-content');
  if (contentDiv) {
    contentDiv.innerHTML = window.marked.parse(state._streamBuffer);
    postProcessCodeBlocks(contentDiv);
  }
  // Smart auto-scroll: only scroll if user hasn't scrolled up
  const { scrollTop, scrollHeight, clientHeight } = DOM.messages;
  if (shouldAutoScroll(scrollTop, scrollHeight, clientHeight)) {
    DOM.messages.scrollTop = scrollHeight;
    state._userScrolled = false;
  }
}

function appendToken(text) {
  state._streamBuffer += text;
  if (DOM.typingLabel) DOM.typingLabel.textContent = 'Claude is thinking…';
  DOM.typingIndicator.classList.remove('visible');
  if (!state._rafPending) {
    state._rafPending = true;
    requestAnimationFrame(flushStreamBuffer);
  }
}

function appendToolCall(id, name, inputJson) {
  if (!state.currentMsgId) return;
  const msg = state.messages.find(m => m.id === state.currentMsgId);
  if (!msg) return;
  state.toolCallCount++;
  msg.toolCalls.push({ id, name, inputJson, status: 'running' });
  if (DOM.typingLabel && DOM.typingIndicator.classList.contains('visible')) {
    DOM.typingLabel.textContent = 'Running tools…';
  }
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
  if (!msgEl) return;
  let group = msgEl.querySelector('.tool-group');
  if (!group) {
    group = renderToolCalls(msg.toolCalls);
    if (group) msgEl.appendChild(group);
  } else {
    const label = group.querySelector('.tool-group-label');
    if (label) label.textContent = `Ran ${msg.toolCalls.length} command${msg.toolCalls.length > 1 ? 's' : ''}`;
    const body = group.querySelector('.tool-group-body');
    if (body) body.appendChild(renderToolCallItem(msg.toolCalls[msg.toolCalls.length - 1]));
  }
}

function appendToolResult(toolUseId, content, isError) {
  if (!state.currentMsgId) return;
  const msg = state.messages.find(m => m.id === state.currentMsgId);
  if (!msg) return;
  const tc = msg.toolCalls.find(t => t.id === toolUseId);
  if (!tc) return;
  tc.result = content;
  tc.isError = isError;
  tc.status = isError ? 'error' : 'done';
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
  if (!msgEl) return;
  const itemEl = msgEl.querySelector(`[data-tool-id="${toolUseId}"]`);
  if (!itemEl) return;
  const statusEl = itemEl.querySelector('.tool-status');
  if (statusEl) {
    statusEl.className = `tool-status ${isError ? 'error' : 'done'}`;
    const elapsedStr = tc.elapsedSeconds != null ? ` (${tc.elapsedSeconds.toFixed(1)}s)` : '';
    statusEl.textContent = isError ? `✗ error${elapsedStr}` : `✓ done${elapsedStr}`;
  }
  let wrapper = itemEl.querySelector('.tool-result-wrapper');
  if (!wrapper) {
    wrapper = makeToolResultEl(content, isError);
    itemEl.appendChild(wrapper);
  } else {
    const pre = wrapper.querySelector('.tool-result');
    if (pre) { pre.textContent = content; pre.className = `tool-result${isError ? ' tool-result-error' : ''}`; }
  }
  // Auto-expand the group when a result arrives so output is visible
  const group = itemEl.closest('.tool-group');
  if (group) group.classList.add('expanded');
}

function appendSubAgentMessage(parentToolUseId, text) {
  if (!state.currentMsgId) return;
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
  if (!msgEl) return;
  const key = `sub-agent-${CSS.escape(parentToolUseId)}`;
  let block = msgEl.querySelector(`[data-sub-agent="${parentToolUseId}"]`);
  if (!block) {
    block = document.createElement('div');
    block.className = 'sub-agent-block';
    block.dataset.subAgent = parentToolUseId;
    const header = document.createElement('div');
    header.className = 'sub-agent-header';
    header.innerHTML = '<span class="sub-agent-arrow">▶</span><span>↳ Sub-agent</span>';
    header.addEventListener('click', () => block.classList.toggle('expanded'));
    const body = document.createElement('div');
    body.className = 'sub-agent-body msg-content';
    block.append(header, body);
    msgEl.appendChild(block);
  }
  const body = block.querySelector('.sub-agent-body');
  if (body) {
    body.innerHTML = window.marked.parse(text);
    postProcessCodeBlocks(body);
  }
}

function startStreaming() {
  state.streaming = true;
  if (DOM.rateLimitBanner) DOM.rateLimitBanner.classList.remove('visible');
  const msg = { id: mkId(), role: 'assistant', content: '', toolCalls: [], timestamp: new Date().toISOString() };
  state.messages.push(msg);
  state.currentMsgId = msg.id;
  state._streamBuffer = '';
  state._thinkingBuffer = '';
  DOM.messages.appendChild(renderMessage(msg));
  DOM.typingIndicator.classList.add('visible');
  DOM.stopBtn.classList.add('visible');
  DOM.sendBtn.style.display = 'none';
  DOM.inputArea.classList.add('locked');
  DOM.textarea.disabled = true;
  if (DOM.scrollToBottomBtn) DOM.scrollToBottomBtn.classList.remove('visible');
}

function endStreaming() {
  state.streaming = false;
  if (state._rafPending) {
    state._rafPending = false;
    const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
    if (msgEl) {
      const cd = msgEl.querySelector('.msg-content');
      if (cd) { cd.innerHTML = window.marked.parse(state._streamBuffer); postProcessCodeBlocks(cd); }
    }
  }
  const msg = state.messages.find(m => m.id === state.currentMsgId);
  if (msg) {
    msg.content = state._streamBuffer;
    if (state._thinkingBuffer) msg.thinking = state._thinkingBuffer;
    msg.toolCalls.forEach(tc => { if (tc.status === 'running') tc.status = 'done'; });
    const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
    if (msgEl) {
      msgEl.querySelectorAll('.tool-status.running').forEach(el => {
        el.className = 'tool-status done'; el.textContent = '✓ done';
      });
      // Regenerate button (appears on hover via CSS)
      if (!msgEl.querySelector('.msg-regenerate') && !state._summaryCapturing) {
        const regenBtn = document.createElement('button');
        regenBtn.className = 'msg-regenerate';
        regenBtn.title = 'Regenerate response';
        regenBtn.innerHTML = '↺ Retry';
        regenBtn.addEventListener('click', regenerate);
        msgEl.appendChild(regenBtn);
      }
    }
  }
  if (state._summaryCapturing) {
    state._summaryCapturing = false;
    const last = state.messages[state.messages.length - 1];
    try {
      const parsed = JSON.parse(last.content.replace(/```json\n?|```/g, '').trim());
      state.summaryData = parsed;
    } catch {
      state.summaryData = { purpose: last.content, current_state: '', outcome: '' };
    }
    state.messages.pop();
    DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`)?.remove();
    if (state.viewMode === 'summary') renderSummaryContent();
    DOM.generateSummaryBtn.disabled = false;
    DOM.generateSummaryBtn.textContent = 'Regenerate summary';
  }
  state.currentMsgId = null;
  state._streamBuffer = '';
  state.tokenCount++;
  DOM.typingIndicator.classList.remove('visible');
  DOM.stopBtn.classList.remove('visible');
  DOM.sendBtn.style.display = '';
  DOM.inputArea.classList.remove('locked');
  DOM.textarea.disabled = false;
  DOM.textarea.focus();
}

// ── Send ───────────────────────────────────────────────────────────────────
function sendMessage() {
  const text = DOM.textarea.value.trim();
  if ((!text && !state.pendingAttachments.length) || state.streaming || !bridge) return;

  const attachments = state.pendingAttachments.slice();
  const msg = {
    id: mkId(),
    role: 'user',
    content: text,
    attachments,
    toolCalls: [],
    timestamp: new Date().toISOString(),
  };
  state.messages.push(msg);

  const msgEl = renderMessage(msg);
  DOM.messages.appendChild(msgEl);
  DOM.messages.scrollTop = DOM.messages.scrollHeight;

  DOM.textarea.value = '';
  DOM.textarea.style.height = '';
  clearDraft();
  state.pendingAttachments = [];
  renderPendingAttachments();

  const attachmentsJson = JSON.stringify(attachments);
  state._lastPrompt = { text, attachmentsJson };
  startStreaming();
  bridge.sendMessage(text, attachmentsJson);
}

function regenerate() {
  if (!bridge || state.streaming || !state._lastPrompt) return;
  // Remove last assistant message so the new response takes its place
  const lastAsst = [...state.messages].reverse().find(m => m.role === 'assistant');
  if (lastAsst) {
    state.messages = state.messages.filter(m => m.id !== lastAsst.id);
    DOM.messages.querySelector(`[data-msg-id="${lastAsst.id}"]`)?.remove();
  }
  startStreaming();
  bridge.sendMessage(state._lastPrompt.text, state._lastPrompt.attachmentsJson);
}

// ── Sessions ───────────────────────────────────────────────────────────────

// ── Session rename ───────────────────────────────────────────────────────────
function makeSessionItem(s) {
  const item = document.createElement('div');
  item.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '');
  item.dataset.sid = s.id;

  const preview = document.createElement('div');
  preview.className = 'session-preview';
  preview.textContent = s.name || s.preview;

  const time = document.createElement('div');
  time.className = 'session-time';
  time.textContent = relativeTime(s.timestamp);

  const delBtn = document.createElement('button');
  delBtn.className = 'session-delete-btn';
  delBtn.title = 'Delete session';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Delete this session? This cannot be undone.')) return;
    if (s.id === state.activeSessionId) {
      state.messages = [];
      state.activeSessionId = '';
      DOM.messages.innerHTML = '';
      hideSummaryView();
      resetStatusline();
    }
    bridge.deleteSession(s.id);
    showToast('Session deleted');
  });

  item.appendChild(preview);
  item.appendChild(time);
  item.appendChild(delBtn);

  // Double-click preview to rename
  preview.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startSessionRename(s.id, preview);
  });

  item.addEventListener('click', () => {
    state.activeSessionId = s.id;
    DOM.sessionList.querySelectorAll('.session-item').forEach(el => el.classList.toggle('active', el.dataset.sid === s.id));
    bridge.loadSession(s.id);
    restoreDraft();
  });

  return item;
}

function startSessionRename(sessionId, previewEl) {
  const currentText = previewEl.textContent;
  const input = document.createElement('input');
  input.className = 'session-rename-input';
  input.type = 'text';
  input.value = currentText;
  input.maxLength = 80;

  previewEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (!newName) {
      // Empty input — cancel instead
      input.replaceWith(previewEl);
      return;
    }
    bridge.renameSession(sessionId, newName);
  }

  function cancel() {
    if (committed) return;
    committed = true;
    input.replaceWith(previewEl);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', () => commit());
  input.addEventListener('click', (e) => e.stopPropagation());
}

function renderSessions(sessions) {
  state.sessions = (sessions || []).sort((a, b) => b.timestamp - a.timestamp);
  DOM.sessionList.innerHTML = '';
  if (!state.sessions.length) {
    DOM.sessionList.innerHTML = '<div class="session-empty">No conversations yet</div>';
    return;
  }
  state.sessions.forEach(s => {
    DOM.sessionList.appendChild(makeSessionItem(s));
  });
}

function loadSessionHistory(turns) {
  state.messages = turns.map(turn => ({
    id: mkId(),
    role: turn.role,
    content: turn.text,
    attachments: turn.attachments || [],
    toolCalls: [],
    timestamp: new Date().toISOString(),
  }));
  renderMessages();
}

// ── View popup ─────────────────────────────────────────────────────────────
const VIEW_MODES = [
  { key: 'normal',   label: 'Normal' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'verbose',  label: 'Verbose' },
  { key: 'summary',  label: 'Summary' },
];

function syncViewPopupState() {
  VIEW_MODES.forEach(({ key }) => {
    const el = DOM.viewPopup.querySelector(`[data-view="${key}"]`);
    if (!el) return;
    el.classList.toggle('selected', state.viewMode === key);
    const check = el.querySelector('.view-check');
    if (check) check.textContent = state.viewMode === key ? '✓' : '';
  });
  ['sm', 'md', 'lg'].forEach(k => {
    const el = DOM.viewPopup.querySelector(`[data-font="${k}"]`);
    if (el) el.classList.toggle('active', state.fontSize === k);
  });
  DOM.viewSelectorLabel.textContent = VIEW_MODES.find(v => v.key === state.viewMode)?.label ?? 'Normal';
}

function toggleViewPopup() {
  DOM.viewPopup.classList.toggle('open');
  if (DOM.viewPopup.classList.contains('open')) {
    const rect = DOM.viewSelectorBtn.getBoundingClientRect();
    Object.assign(DOM.viewPopup.style, {
      top: (rect.bottom + 4) + 'px',
      left: 'auto',
      right: (window.innerWidth - rect.right) + 'px',
    });
    syncViewPopupState();
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem('viewMode', mode);
  syncViewPopupState();
  renderMessages();
  // Expand/collapse thinking blocks based on Thinking view mode
  DOM.messages.querySelectorAll('.thinking-block').forEach(el => {
    el.classList.toggle('expanded', mode === 'thinking');
  });
}

function setFontSize(size) {
  state.fontSize = size;
  localStorage.setItem('fontSize', size);
  applyFontSize();
  syncViewPopupState();
}

function applyFontSize() {
  DOM.messages.classList.remove('fs-sm', 'fs-md', 'fs-lg');
  DOM.messages.classList.add(`fs-${state.fontSize}`);
}

// ── Summary view ───────────────────────────────────────────────────────────
function showSummaryView() {
  DOM.messages.style.display = 'none';
  DOM.summaryView.classList.add('visible');
  renderSummaryStats();
  renderSummaryLastTurn();
  renderSummaryContent();
}

function hideSummaryView() {
  DOM.messages.style.display = '';
  DOM.summaryView.classList.remove('visible');
}

function renderSummaryStats() {
  DOM.summaryStats.innerHTML =
    `<div class="summary-stat"><span class="summary-stat-value">${state.messages.length}</span> turns</div>` +
    `<div class="summary-stat"><span class="summary-stat-value">${state.toolCallCount}</span> tool calls</div>`;
}

function renderSummaryLastTurn() {
  DOM.summaryLastTurn.innerHTML = '';
  const lastUser = [...state.messages].reverse().find(m => m.role === 'user');
  const lastAsst = [...state.messages].reverse().find(m => m.role === 'assistant');
  if (lastUser) DOM.summaryLastTurn.appendChild(renderMessage(lastUser));
  if (lastAsst) DOM.summaryLastTurn.appendChild(renderMessage(lastAsst));
}

function renderSummaryContent() {
  DOM.summaryContent.innerHTML = '';
  if (!state.summaryData) return;
  [['purpose', 'Purpose'], ['current_state', 'Current State'], ['outcome', 'Outcome']].forEach(([key, label]) => {
    if (!state.summaryData[key]) return;
    const sec = document.createElement('div');
    sec.className = 'summary-section';
    sec.innerHTML = `<div class="summary-section-label">${label}</div><div class="summary-section-text">${escHtml(state.summaryData[key])}</div>`;
    DOM.summaryContent.appendChild(sec);
  });
}

function generateSummary() {
  if (state.streaming || !bridge) return;
  state._summaryCapturing = true;
  DOM.generateSummaryBtn.disabled = true;
  DOM.generateSummaryBtn.textContent = 'Generating…';
  startStreaming();
  bridge.sendMessage('Summarize this conversation in exactly this JSON format (respond with only the JSON, no markdown fences): {"purpose": "one sentence", "current_state": "2-3 sentences", "outcome": "2-3 sentences"}', '[]');
}

// ── Permission dialog ──────────────────────────────────────────────────────
function showPermissionDialog(requestId, toolName, inputJson, title, description, displayName, decisionReason, blockedPath) {
  _pendingPermissionRequestId = requestId;

  DOM.permissionToolName.textContent = displayName || toolName;

  const titleText = title || (decisionReason ? `Claude wants to use ${toolName}: ${decisionReason}` : `Claude wants to use ${toolName}`);
  DOM.permissionTitle.textContent = titleText;

  DOM.permissionDesc.textContent = description || '';
  DOM.permissionDesc.style.display = description ? '' : 'none';

  if (blockedPath) {
    DOM.permissionBlockedPath.textContent = blockedPath;
    DOM.permissionBlockedPath.style.display = '';
  } else {
    DOM.permissionBlockedPath.style.display = 'none';
  }

  DOM.permissionModal.classList.add('visible');
}

function dismissPermissionDialog() {
  DOM.permissionModal.classList.remove('visible');
  _pendingPermissionRequestId = null;
}

function respondPermission(allow, alwaysAllow) {
  if (!bridge || !_pendingPermissionRequestId) return;
  bridge.respondToPermission(_pendingPermissionRequestId, allow, alwaysAllow);
  dismissPermissionDialog();
}

// ── Transcript export ──────────────────────────────────────────────────────
function exportTranscript() {
  if (!bridge || !state.messages.length) return;
  const lines = [];
  state.messages.forEach(msg => {
    if (msg.role === 'user') {
      lines.push('## User\n');
      lines.push(msg.content || '');
      if (msg.attachments && msg.attachments.length > 0) {
        lines.push(`\n_${msg.attachments.length} image(s) attached_`);
      }
    } else {
      lines.push('## Assistant\n');
      lines.push(msg.content || '');
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push('\n**Tools used:**');
        msg.toolCalls.forEach(tc => {
          lines.push(`- \`${tc.name}\` — ${tc.status}`);
          if (tc.result) lines.push(`\n  \`\`\`\n  ${tc.result.trim()}\n  \`\`\``);
        });
      }
    }
    lines.push('\n\n---\n');
  });
  const markdown = `# Conversation Transcript\n\n${lines.join('\n')}`;
  bridge.writeTextFile('transcript.md', markdown);
}

// ── Search ─────────────────────────────────────────────────────────────────
const _search = { active: false, query: '', marks: [], currentIdx: -1 };

function highlightInElement(el, query) {
  if (!el || !query) return;
  const lower = query.toLowerCase();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement.closest('mark')) textNodes.push(node);
  }
  textNodes.forEach(textNode => {
    const text = textNode.textContent;
    const lowerText = text.toLowerCase();
    if (!lowerText.includes(lower)) return;
    const frag = document.createDocumentFragment();
    let lastIdx = 0, searchFrom = 0, matchIdx;
    while ((matchIdx = lowerText.indexOf(lower, searchFrom)) !== -1) {
      if (matchIdx > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, matchIdx)));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = text.slice(matchIdx, matchIdx + query.length);
      frag.appendChild(mark);
      lastIdx = matchIdx + query.length;
      searchFrom = lastIdx;
    }
    if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    textNode.parentNode.replaceChild(frag, textNode);
  });
}

function clearSearchHighlights() {
  DOM.messages.querySelectorAll('mark.search-highlight').forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
  DOM.messages.querySelectorAll('.search-match, .search-dim').forEach(el =>
    el.classList.remove('search-match', 'search-dim'));
}

function navigateToMark(idx) {
  if (!_search.marks.length) return;
  if (_search.currentIdx >= 0) _search.marks[_search.currentIdx]?.classList.remove('current');
  _search.currentIdx = ((idx % _search.marks.length) + _search.marks.length) % _search.marks.length;
  const mark = _search.marks[_search.currentIdx];
  mark.classList.add('current');
  mark.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  DOM.searchCount.textContent = `${_search.currentIdx + 1} of ${_search.marks.length}`;
}

function openSearch() {
  _search.active = true;
  DOM.searchBar.classList.add('visible');
  DOM.searchInput.focus();
  DOM.searchInput.select();
}

function closeSearch() {
  clearSearchHighlights();
  _search.active = false;
  _search.query = '';
  _search.marks = [];
  _search.currentIdx = -1;
  DOM.searchBar.classList.remove('visible');
  DOM.searchInput.value = '';
  DOM.searchCount.textContent = '';
}

function runSearch(query) {
  _search.query = query;
  clearSearchHighlights();
  _search.marks = [];
  _search.currentIdx = -1;
  if (!query) { DOM.searchCount.textContent = ''; return; }

  const lower = query.toLowerCase();
  [...DOM.messages.children].forEach(el => {
    const msgId = el.dataset.msgId;
    const msg = state.messages.find(m => m.id === msgId);
    const plainText = (msg?.content || '') + (msg?.toolCalls?.map(tc => tc.result || '').join(' ') || '');
    const hasMatch = plainText.toLowerCase().includes(lower);
    el.classList.toggle('search-match', hasMatch);
    el.classList.toggle('search-dim', !hasMatch);
    if (hasMatch) {
      [el.querySelector('.msg-content'), el.querySelector('.msg-bubble'),
       ...el.querySelectorAll('.tool-result')].filter(Boolean)
        .forEach(area => highlightInElement(area, query));
    }
  });

  _search.marks = [...DOM.messages.querySelectorAll('mark.search-highlight')];
  if (_search.marks.length) {
    navigateToMark(0);
  } else {
    DOM.searchCount.textContent = 'No matches';
  }
}

// ── Controls ───────────────────────────────────────────────────────────────
const MODELS = [
  { value: '',       label: 'Default' },
  { value: 'opus',   label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku',  label: 'Haiku' },
];

function buildModelDropdown() {
  DOM.modelDropdown.innerHTML = '';
  MODELS.forEach(({ value, label }) => {
    const el = document.createElement('div');
    el.className = 'model-option' + (state.model === value ? ' selected' : '');
    el.dataset.model = value;
    el.innerHTML = `<span>${label}</span>${state.model === value ? '<span>✓</span>' : ''}`;
    el.addEventListener('click', () => { syncModel(value); bridge.setModel(value); DOM.modelDropdown.classList.remove('open'); });
    DOM.modelDropdown.appendChild(el);
  });
}

function populateModelPicker(models) {
  if (!models || !models.length) return;
  // Keep the 'Default' entry and replace the rest with SDK-provided models
  MODELS.length = 1; // keep index 0 (Default)
  models.forEach(m => {
    if (m.id) MODELS.push({ value: m.id, label: m.displayName || m.id });
  });
  buildModelDropdown();
  syncModel(state.model);
}

function syncModel(val) {
  state.model = val;
  const found = MODELS.find(m => m.value === val || (m.value && val && val.toLowerCase().includes(m.value)));
  DOM.modelBtnLabel.textContent = found?.label || val || 'Default';
}

function syncYolo(enabled) {
  state.yolo = !!enabled;
  DOM.yoloBtn.classList.toggle('yolo-on', state.yolo);
}

const PERM_MODES = [
  { value: 'default',     label: 'Safe',   title: 'Prompt for all tool permissions' },
  { value: 'acceptEdits', label: 'Smart',  title: 'Auto-approve file edits; prompt for network/shell' },
  { value: 'auto',        label: 'Auto',   title: 'AI classifier approves/denies permissions' },
];

function syncPermMode(mode) {
  state.permissionMode = mode;
  localStorage.setItem('permissionMode', mode);
  const found = PERM_MODES.find(m => m.value === mode) || PERM_MODES[0];
  DOM.permModeBtn.textContent = found.label;
  DOM.permModeBtn.title = found.title;
  DOM.permModeBtn.dataset.mode = mode;
  DOM.permModeBtn.classList.toggle('perm-smart', mode === 'acceptEdits');
  DOM.permModeBtn.classList.toggle('perm-auto', mode === 'auto');
  if (bridge) bridge.setPermissionMode(mode);
}

function syncCwd(path) {
  state.cwd = path || '';
  const homeMatch = state.cwd.match(/^\/(?:Users|home)\/[^/]+/);
  const display = homeMatch ? state.cwd.replace(homeMatch[0], '~') : state.cwd;
  DOM.cwdBtn.textContent = display || '~/';
  DOM.cwdBtn.title = state.cwd;
}

// ── Statusline ─────────────────────────────────────────────────────────────
function shortModelName(model) {
  return model ? model.replace(/^claude-/, '') : 'default';
}

function syncStatuslineModel(model) {
  DOM.statuslineModel.textContent = shortModelName(model);
}

function syncFastMode(state) {
  if (!DOM.statuslineFastMode) return;
  DOM.statuslineFastMode.className = 'fast-mode-badge ' + (
    state === 'on' ? 'fast-mode-on' :
    state === 'cooldown' ? 'fast-mode-cooldown' : ''
  );
  DOM.statuslineFastMode.textContent = state === 'on' ? '⚡' : state === 'cooldown' ? '⚡̱' : '';
  DOM.statuslineFastMode.title = state === 'on' ? 'Fast mode on' : state === 'cooldown' ? 'Fast mode recharging' : '';
}

function resetStatusline() {
  DOM.statuslineBarFill.style.width = '0%';
  DOM.statuslineBarFill.classList.remove('bar-warn', 'bar-danger');
  DOM.statuslineBarTrack.style.display = '';
  DOM.statuslineBarTrack.title = '';
  DOM.statuslinePct.textContent = '—';
  DOM.statuslinePct.title = '';
  DOM.statuslineTurns.textContent = '—';
}

function onUsageUpdated(jsonStr) {
  let data;
  try { data = JSON.parse(jsonStr); } catch { return; }
  const { inputTokens = 0, outputTokens = 0, contextWindow = 0, numTurns = 0,
          stopReason = '', subtype = '', cacheReadTokens = 0, cacheCreatedTokens = 0 } = data;

  // Stamp token + stop-reason + cache badge on the last assistant message
  const lastAsstEl = [...DOM.messages.querySelectorAll('[data-msg-id]')].reverse()
    .find(el => el.classList.contains('msg-assistant'));
  if (lastAsstEl) {
    let badge = lastAsstEl.querySelector('.msg-meta-badge');
    if (!badge) { badge = document.createElement('div'); badge.className = 'msg-meta-badge'; lastAsstEl.appendChild(badge); }
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const total = inputTokens + outputTokens;
    const reasonLabel = stopReason === 'end_turn' ? '' : stopReason ? ` · ${stopReason.replace(/_/g, ' ')}` : '';
    const subtypeWarn = subtype && subtype !== 'success' ? ` · ${subtype.replace(/_/g, ' ')}` : '';
    const cacheLabel  = cacheReadTokens > 0 ? ' · 💾 cached' : '';
    badge.textContent = `${fmt(total)} tokens${cacheLabel}${reasonLabel}${subtypeWarn}`;
    const cacheTip = cacheReadTokens > 0
      ? `\ncache read: ${fmt(cacheReadTokens)}${cacheCreatedTokens > 0 ? ` · created: ${fmt(cacheCreatedTokens)}` : ''}`
      : '';
    badge.title = `${fmt(inputTokens)} in + ${fmt(outputTokens)} out${cacheTip}`;
  }

  DOM.statuslineTurns.textContent = numTurns === 1 ? '1 turn' : `${numTurns} turns`;

  if (contextWindow > 0) {
    const total = inputTokens + outputTokens;
    const pct   = Math.min(100, Math.round((total / contextWindow) * 100));
    const fmt   = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const tip   = `${fmt(inputTokens)} in + ${fmt(outputTokens)} out / ${fmt(contextWindow)} ctx tokens`;

    DOM.statuslineBarTrack.style.display = '';
    DOM.statuslineBarFill.style.width = pct + '%';
    DOM.statuslineBarFill.classList.toggle('bar-warn',   pct >= 60 && pct < 85);
    DOM.statuslineBarFill.classList.toggle('bar-danger', pct >= 85);
    DOM.statuslineBarTrack.title = tip;
    DOM.statuslinePct.textContent = pct + '%';
    DOM.statuslinePct.title = tip;
  } else {
    const total = inputTokens + outputTokens;
    const fmt   = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    DOM.statuslineBarTrack.style.display = 'none';
    DOM.statuslinePct.textContent = `${fmt(total)} tokens`;
    DOM.statuslinePct.title = '';
    DOM.statuslineBarTrack.title = '';
  }
}

// ── Sidebar toggle ────────────────────────────────────────────────────────
function initSidebarState() {
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    document.getElementById('app').classList.add('sidebar-collapsed');
  }
}

function toggleSidebar() {
  const app = document.getElementById('app');
  const collapsed = app.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed);
}

// ── Draft persistence ───────────────────────────────────────────────────────
function saveDraft() {
  _saveDraft(state.activeSessionId, DOM.textarea.value);
}

function restoreDraft() {
  const val = _restoreDraft(state.activeSessionId);
  if (val) DOM.textarea.value = val;
}

function clearDraft() {
  _clearDraft(state.activeSessionId);
}

// ── Events ─────────────────────────────────────────────────────────────────
function wireEvents() {
  DOM.sidebarToggle.addEventListener('click', toggleSidebar);

  DOM.textarea.addEventListener('input', () => {
    DOM.textarea.style.height = 'auto';
    DOM.textarea.style.height = Math.min(DOM.textarea.scrollHeight, 200) + 'px';
    saveDraft();
  });
  DOM.textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  document.addEventListener('keydown', e => {
    if (state.streaming && e.key === 'Enter' && !e.shiftKey && document.activeElement === DOM.textarea) {
      e.stopImmediatePropagation(); e.preventDefault();
    }
  }, true);
  DOM.sendBtn.addEventListener('click', sendMessage);
  DOM.stopBtn.addEventListener('click', () => { if (bridge) bridge.abort(); });
  if (DOM.scrollToBottomBtn) {
    DOM.scrollToBottomBtn.addEventListener('click', () => {
      DOM.messages.scrollTop = DOM.messages.scrollHeight;
      state._userScrolled = false;
      DOM.scrollToBottomBtn.classList.remove('visible');
    });
  }
  DOM.cwdBtn.addEventListener('click', () => { if (bridge) bridge.pickFolder(); });
  DOM.newSessionBtn.addEventListener('click', () => {
    if (!bridge) return;
    Object.assign(state, { messages: [], activeSessionId: '', tokenCount: 0, toolCallCount: 0, summaryData: null });
    DOM.messages.innerHTML = '';
    hideSummaryView();
    DOM.sessionList.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
    state.pendingAttachments = [];
    renderPendingAttachments();
    bridge.newSession();
    clearDraft();
  });
  document.getElementById('fork-session-btn')?.addEventListener('click', () => {
    if (bridge && state.activeSessionId) bridge.forkSession();
  });
  DOM.modelBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (DOM.modelDropdown.classList.contains('open')) {
      DOM.modelDropdown.classList.remove('open');
    } else {
      syncModel(bridge.model); buildModelDropdown(); DOM.modelDropdown.classList.add('open');
    }
  });
  document.addEventListener('click', () => DOM.modelDropdown.classList.remove('open'));
  DOM.modelDropdown.addEventListener('click', e => e.stopPropagation());
  DOM.yoloBtn.addEventListener('click', () => { const v = !state.yolo; if (bridge) bridge.setYolo(v); syncYolo(v); });
  if (DOM.thinkingSelect) {
    DOM.thinkingSelect.addEventListener('change', () => {
      if (bridge) bridge.setThinking(DOM.thinkingSelect.value, 8000);
    });
  }
  if (DOM.runOptsToggle) {
    DOM.runOptsToggle.addEventListener('click', () => {
      const visible = DOM.runOptionsRow.style.display !== 'none';
      DOM.runOptionsRow.style.display = visible ? 'none' : '';
      DOM.systemPromptRow.style.display = visible ? 'none' : '';
      if (DOM.toolControlsRow) {
        DOM.toolControlsRow.style.display = visible ? 'none' : '';
      }
      DOM.runOptsToggle.classList.toggle('run-opts-active', !visible);
    });
  }
  if (DOM.applyRunOptsBtn) {
    DOM.applyRunOptsBtn.addEventListener('click', () => {
      if (!bridge) return;
      const maxTurns   = parseInt(DOM.maxTurnsInput?.value || '0', 10) || 0;
      const maxBudget  = parseFloat(DOM.maxBudgetInput?.value || '0') || 0;
      const effort     = DOM.effortSelect?.value || '';
      const sysPrompt  = DOM.systemPromptInput?.value?.trim() || '';
      bridge.setRunOptions(maxTurns, maxBudget, effort, sysPrompt);
    });
  }
  if (DOM.applyToolControlsBtn) {
    DOM.applyToolControlsBtn.addEventListener('click', () => {
      if (!bridge) return;
      const parseTools = (s) => JSON.stringify(
        (s || '').split(',').map(t => t.trim()).filter(Boolean)
      );
      bridge.setToolControls(
        parseTools(DOM.allowedToolsInput?.value),
        parseTools(DOM.disallowedToolsInput?.value)
      );
    });
  }
  DOM.permModeBtn.addEventListener('click', () => {
    const idx = PERM_MODES.findIndex(m => m.value === state.permissionMode);
    syncPermMode(PERM_MODES[(idx + 1) % PERM_MODES.length].value);
  });
  DOM.viewSelectorBtn.addEventListener('click', e => { e.stopPropagation(); toggleViewPopup(); });
  document.addEventListener('click', () => DOM.viewPopup.classList.remove('open'));
  DOM.viewPopup.addEventListener('click', e => e.stopPropagation());
  VIEW_MODES.forEach(({ key }) => {
    DOM.viewPopup.querySelector(`[data-view="${key}"]`)?.addEventListener('click', () => { setViewMode(key); DOM.viewPopup.classList.remove('open'); });
  });
  ['sm', 'md', 'lg'].forEach(k => {
    DOM.viewPopup.querySelector(`[data-font="${k}"]`)?.addEventListener('click', () => setFontSize(k));
  });
  DOM.generateSummaryBtn.addEventListener('click', generateSummary);
  DOM.exitSummaryBtn.addEventListener('click', () => setViewMode('normal'));

  // Search
  DOM.searchBtn.addEventListener('click', () => _search.active ? closeSearch() : openSearch());
  DOM.searchInput.addEventListener('input', () => runSearch(DOM.searchInput.value.trim()));
  DOM.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? navigateToMark(_search.currentIdx - 1) : navigateToMark(_search.currentIdx + 1);
    }
  });
  DOM.searchPrev.addEventListener('click', () => navigateToMark(_search.currentIdx - 1));
  DOM.searchNext.addEventListener('click', () => navigateToMark(_search.currentIdx + 1));
  DOM.searchClose.addEventListener('click', closeSearch);

  // Export button
  DOM.exportBtn.addEventListener('click', exportTranscript);

  // Permission dialog buttons
  DOM.permissionDenyBtn.addEventListener('click',    () => respondPermission(false, false));
  DOM.permissionAllowBtn.addEventListener('click',   () => respondPermission(true,  false));
  DOM.permissionSessionBtn.addEventListener('click', () => respondPermission(true,  true));
  DOM.permissionAlwaysBtn.addEventListener('click',  () => respondPermission(true,  true));

  // Attach button
  DOM.attachBtn.addEventListener('click', () => { if (bridge) bridge.pickImages(); });

  // Image preview modal close (click or button)
  DOM.imagePreviewClose.addEventListener('click', () => DOM.imagePreviewModal.classList.remove('visible'));
  DOM.imagePreviewModal.addEventListener('click', (e) => {
    if (e.target === DOM.imagePreviewModal) DOM.imagePreviewModal.classList.remove('visible');
  });

  // Global Escape + ⌘F — ordered by overlay priority
  document.addEventListener('keydown', (e) => {
    // Keyboard shortcuts — only when not focused on textarea
    if (document.activeElement !== DOM.textarea) {
      if (e.key === 'ArrowUp' && state.messages.length) {
        e.preventDefault();
        focusMsgByIdx(navigateUp(state._focusedMsgIdx, state.messages.length));
        return;
      }
      if (e.key === 'ArrowDown' && state.messages.length) {
        e.preventDefault();
        focusMsgByIdx(navigateDown(state._focusedMsgIdx, state.messages.length));
        return;
      }
    }

    if (e.key === 'Escape') {
      if (DOM.imagePreviewModal.classList.contains('visible')) { DOM.imagePreviewModal.classList.remove('visible'); return; }
      if (DOM.permissionModal.classList.contains('visible'))   { respondPermission(false, false); return; }
      if (_search.active)                                       { closeSearch(); return; }
      if (state.viewMode === 'summary')                        { setViewMode('normal'); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); openSearch(); }

    // ⌘K — focus the textarea
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      DOM.textarea.focus();
      DOM.textarea.scrollIntoView({ block: 'nearest' });
    }

    // ⌘N — new session (only when not typing in textarea)
    if ((e.metaKey || e.ctrlKey) && e.key === 'n' && document.activeElement !== DOM.textarea) {
      e.preventDefault();
      DOM.newSessionBtn.click();
    }
  });

  // Paste images from clipboard — delegate to C++ which reads QApplication::clipboard()
  // directly. Qt WebEngine does not expose clipboard image data through the DataTransfer API.
  DOM.textarea.addEventListener('paste', (e) => {
    if (bridge) bridge.pasteImageFromClipboard();
  });

  // Drag-and-drop images onto the main area
  const mainEl = document.getElementById('main');
  let dragCount = 0;
  mainEl.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCount++;
    mainEl.classList.add('drag-over');
  });
  mainEl.addEventListener('dragover', (e) => {
    e.preventDefault(); // required to allow drop
  });
  mainEl.addEventListener('dragleave', () => {
    if (--dragCount <= 0) {
      dragCount = 0;
      mainEl.classList.remove('drag-over');
    }
  });
  mainEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCount = 0;
    mainEl.classList.remove('drag-over');
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    const results = await Promise.allSettled(files.map(importClipboardFile));
    const imported = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (imported.length) {
      state.pendingAttachments.push(...imported);
      renderPendingAttachments();
    }
  });
}

function onAskUserQuestion(requestId, questions) {
  const card = document.createElement('div');
  card.className = 'ask-question-card';
  card.dataset.requestId = requestId;

  const answers = {};

  questions.forEach(q => {
    const section = document.createElement('div');
    section.className = 'ask-question-section';

    const header = document.createElement('div');
    header.className = 'ask-question-header';
    header.textContent = q.header ? `${q.header}: ${q.question}` : q.question;
    section.appendChild(header);

    const chips = document.createElement('div');
    chips.className = 'ask-chips';
    let otherInput;

    q.options.forEach(opt => {
      const chip = document.createElement('button');
      chip.className = 'ask-chip';
      chip.textContent = opt.label;
      chip.title = opt.description || '';
      chip.addEventListener('click', () => {
        if (q.multiSelect) {
          chip.classList.toggle('ask-chip--selected');
          answers[q.question] = Array.from(chips.querySelectorAll('.ask-chip--selected'))
            .map(c => c.textContent);
        } else {
          chips.querySelectorAll('.ask-chip').forEach(c => c.classList.remove('ask-chip--selected'));
          chip.classList.add('ask-chip--selected');
          answers[q.question] = opt.label;
          if (otherInput) otherInput.value = '';
        }
      });
      chips.appendChild(chip);
    });

    otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.className = 'ask-other-input';
    otherInput.placeholder = 'Or type your own answer…';
    otherInput.addEventListener('input', () => {
      if (otherInput.value.trim()) {
        chips.querySelectorAll('.ask-chip').forEach(c => c.classList.remove('ask-chip--selected'));
        answers[q.question] = otherInput.value.trim();
      } else {
        delete answers[q.question];
      }
    });

    section.appendChild(chips);
    section.appendChild(otherInput);
    card.appendChild(section);
  });

  const submitBtn = document.createElement('button');
  submitBtn.className = 'ask-submit-btn';
  submitBtn.textContent = 'Send answers';
  submitBtn.addEventListener('click', () => {
    questions.forEach(q => {
      if (answers[q.question] === undefined && q.options.length > 0) {
        answers[q.question] = q.options[0].label;
      }
    });
    bridge.respondToAskUser(requestId, JSON.stringify(answers));
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sent ✓';
    card.classList.add('ask-question-card--done');
  });

  card.appendChild(submitBtn);
  DOM.messages.appendChild(card);
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
}

function wireBridgeSignals() {
  bridge.textReady.connect(text => appendToken(text));
  bridge.thinkingChunk.connect(text => appendThinkingChunk(text));
  bridge.toolUse.connect((id, name, inputJson) => appendToolCall(id, name, inputJson));
  bridge.toolResult.connect((toolUseId, content, isError) => appendToolResult(toolUseId, content, isError));
  bridge.toolProgress.connect((id, name, elapsedSeconds) => {
    const msg = state.messages.find(m => m.id === state.currentMsgId);
    const tc = msg?.toolCalls.find(t => t.id === id);
    if (!tc) return;
    tc.elapsedSeconds = elapsedSeconds;
    const el = DOM.messages.querySelector(`[data-tool-id="${id}"]`);
    if (!el) return;
    const statusEl = el.querySelector('.tool-status');
    if (statusEl && tc.status === 'running') {
      statusEl.textContent = `⏳ running (${elapsedSeconds.toFixed(1)}s)`;
    }
  });
  bridge.promptSuggestion.connect(suggestion => {
    if (!suggestion) return;
    // Remove any existing chips
    DOM.messages.querySelectorAll('.suggestion-chips').forEach(el => el.remove());
    const lastAsst = [...DOM.messages.querySelectorAll('[data-msg-id]')].reverse()
      .find(el => el.classList.contains('msg-assistant'));
    if (!lastAsst) return;
    const chips = document.createElement('div');
    chips.className = 'suggestion-chips';
    const chip = document.createElement('button');
    chip.className = 'suggestion-chip';
    chip.textContent = `→ ${suggestion}`;
    chip.addEventListener('click', () => {
      DOM.textarea.value = suggestion;
      DOM.textarea.focus();
      chips.remove();
    });
    chips.appendChild(chip);
    lastAsst.appendChild(chips);
  });
  bridge.rateLimit.connect(json => {
    const data = JSON.parse(json);
    const { status, resetsAt, rateLimitType } = data;
    const banner = DOM.rateLimitBanner;
    const text = DOM.rateLimitText;
    banner.classList.remove('visible', 'warning', 'rejected');
    if (status === 'rejected') {
      banner.classList.add('visible', 'rejected');
      text.textContent = `Rate limit reached${rateLimitType ? ` (${rateLimitType})` : ''}. Limit resets at ${resetsAt || 'unknown'}.`;
    } else if (status === 'allowed_warning') {
      banner.classList.add('visible', 'warning');
      text.textContent = `Approaching rate limit${rateLimitType ? ` (${rateLimitType})` : ''}.`;
    } else {
      banner.classList.remove('visible');
    }
  });
  bridge.subAgentMessage.connect((parentToolUseId, text) => appendSubAgentMessage(parentToolUseId, text));
  bridge.permissionRequested.connect((requestId, toolName, inputJson, title, description, displayName, decisionReason, blockedPath) => {
    showPermissionDialog(requestId, toolName, inputJson, title, description, displayName, decisionReason, blockedPath);
  });
  bridge.askUserQuestion.connect((requestId, questionsJson) => {
    onAskUserQuestion(requestId, JSON.parse(questionsJson));
  });
  bridge.turnComplete.connect(() => {
    dismissPermissionDialog();
    if (state.streaming) endStreaming();
  });
  bridge.fileWritten.connect((success, path) => {
    if (!success) return;
    const name = path.split('/').pop() || 'transcript.md';
    showToast(`Saved: ${name}`);
  });
  bridge.errorOccurred.connect(msg => {
    if (state.streaming) endStreaming();
    const errMsg = { id: mkId(), role: 'assistant', content: `**Error:** ${escHtml(msg)}`, toolCalls: [], timestamp: new Date().toISOString() };
    state.messages.push(errMsg);
    DOM.messages.appendChild(renderMessage(errMsg));
  });
  bridge.sessionReady.connect(id => {
    state.activeSessionId = id;
    if (!id) resetStatusline();
    restoreDraft();
  });
  bridge.sessionsListed.connect(json => { try { renderSessions(JSON.parse(json)); } catch {} });
  bridge.sessionHistoryLoaded.connect(json => { try { loadSessionHistory(JSON.parse(json)); restoreDraft(); } catch {} });
  bridge.cwdChanged.connect(path => { syncCwd(path); state.activeSessionId = ''; resetStatusline(); clearDraft(); DOM.textarea.value = ''; DOM.textarea.style.height = ''; bridge.requestSessions(); });
  bridge.modelChanged.connect(model => { syncModel(model); syncStatuslineModel(model); });
  bridge.fastModeStateChanged.connect(state => syncFastMode(state));
  bridge.yoloChanged.connect(enabled => syncYolo(enabled));
  bridge.imagesPicked.connect((json) => {
    try {
      const imported = JSON.parse(json).map(normalizeAttachment);
      state.pendingAttachments.push(...imported);
      renderPendingAttachments();
    } catch(e) { console.error('imagesPicked parse error:', e); }
  });
  bridge.imageImported.connect((requestId, json) => {
    const pending = pendingImports.get(requestId);
    if (!pending) return;
    pendingImports.delete(requestId);
    try {
      pending.resolve(normalizeAttachment(JSON.parse(json)));
    } catch(e) {
      pending.reject(e);
    }
  });
  bridge.modelsListed.connect(json => {
    try { populateModelPicker(JSON.parse(json)); } catch {}
  });
  bridge.usageUpdated.connect(json => onUsageUpdated(json));
  bridge.compactBoundary.connect(json => {
    const data = JSON.parse(json);
    const { preTokens, postTokens, durationMs, trigger } = data;
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n);
    const label = `— context compacted (${fmt(preTokens)} → ${fmt(postTokens)} tokens, ${((durationMs || 0) / 1000).toFixed(1)}s${trigger === 'manual' ? ', manual' : ''}) —`;
    const sep = document.createElement('div');
    sep.className = 'compact-separator';
    sep.textContent = label;
    DOM.messages.appendChild(sep);
    DOM.messages.scrollTop = DOM.messages.scrollHeight;
  });
  bridge.sessionForked.connect((newSessionId) => {
    bridge.requestSessions();
    showToast('Session forked — continuing from here in a new session.');
  });
  bridge.agentNotification.connect((message, notificationType) => {
    if (!message || notificationType === 'subagent_stop') return;
    showToast(`Claude: ${message}`);
  });
  syncCwd(bridge.cwd);
  syncModel(bridge.model);
  syncStatuslineModel(bridge.model);
  syncYolo(bridge.yolo);
  syncPermMode(state.permissionMode);
  bridge.requestSessions();
  bridge.requestModels();
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
(function bootstrap() {
  if (window.marked) window.marked.use({ gfm: true, breaks: true });
  initDOM();
  initSidebarState();
  wireEvents();
  applyFontSize();
  new QWebChannel(qt.webChannelTransport, function(channel) {
    bridge = channel.objects.claude;
    window.__qtBridge__ = bridge;
    syncFastMode('off');
    wireBridgeSignals();
  });
})();
