'use strict';

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
  viewMode: localStorage.getItem('viewMode') || 'normal',
  fontSize: localStorage.getItem('fontSize') || 'md',
  summaryData: null,
  tokenCount: 0,
  toolCallCount: 0,
  _rafPending: false,
  _streamBuffer: '',
  _summaryCapturing: false,
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

// ── DOM refs ───────────────────────────────────────────────────────────────
function initDOM() {
  DOM = {
    sessionList:        document.getElementById('session-list'),
    newSessionBtn:      document.getElementById('new-session-btn'),
    messages:           document.getElementById('messages'),
    typingIndicator:    document.getElementById('typing-indicator'),
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
    yoloBtn:            document.getElementById('yolo-btn'),
    sidebarToggle:      document.getElementById('sidebar-toggle'),
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
    statuslineBarTrack:   document.getElementById('statusline-bar-track'),
    statuslineBarFill:    document.getElementById('statusline-bar-fill'),
    statuslinePct:        document.getElementById('statusline-pct'),
    statuslineTurns:      document.getElementById('statusline-turns'),
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderToolCallItem(tc) {
  const div = document.createElement('div');
  div.className = 'tool-call-item';
  const inputStr = (() => {
    try { return JSON.stringify(JSON.parse(tc.inputJson), null, 2); }
    catch { return tc.inputJson; }
  })();
  div.innerHTML =
    `<div class="tool-name">${escHtml(tc.name)}</div>` +
    (state.viewMode === 'verbose'
      ? `<div class="tool-input">${escHtml(inputStr)}</div>`
      : '') +
    `<div class="tool-status ${tc.status}">${
      tc.status === 'running' ? '⏳ running'
      : tc.status === 'done' ? '✓ done' : '✗ error'
    }</div>`;
  return div;
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
  group.append(header, body);
  return group;
}

function renderMessage(msg) {
  const outer = document.createElement('div');
  outer.dataset.msgId = msg.id;
  if (msg.role === 'user') {
    outer.className = 'msg-user';
    outer.style.flexDirection = 'column';
    outer.style.alignItems = 'flex-end';
    // Show attachment gallery above the text bubble if there are attachments
    if (msg.attachments && msg.attachments.length > 0) {
      outer.appendChild(renderAttachmentRow(msg.attachments));
    }
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.content;
    outer.appendChild(bubble);
  } else {
    outer.className = 'msg-assistant';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    if (msg.content) contentDiv.innerHTML = window.marked.parse(msg.content);
    outer.appendChild(contentDiv);
    if (msg.toolCalls && msg.toolCalls.length > 0 && state.viewMode !== 'summary') {
      const toolEl = renderToolCalls(msg.toolCalls);
      if (toolEl) outer.appendChild(toolEl);
    }
  }
  return outer;
}

function renderMessages() {
  if (state.viewMode === 'summary') { showSummaryView(); return; }
  hideSummaryView();
  DOM.messages.innerHTML = '';
  state.messages.forEach(msg => DOM.messages.appendChild(renderMessage(msg)));
  applyFontSize();
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
}

// ── Streaming ──────────────────────────────────────────────────────────────
function flushStreamBuffer() {
  state._rafPending = false;
  if (!state.currentMsgId) return;
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
  if (!msgEl) return;
  const contentDiv = msgEl.querySelector('.msg-content');
  if (contentDiv) contentDiv.innerHTML = window.marked.parse(state._streamBuffer);
  const { scrollTop, scrollHeight, clientHeight } = DOM.messages;
  if (scrollHeight - scrollTop - clientHeight < 120) DOM.messages.scrollTop = scrollHeight;
}

function appendToken(text) {
  state._streamBuffer += text;
  DOM.typingIndicator.classList.remove('visible');
  if (!state._rafPending) {
    state._rafPending = true;
    requestAnimationFrame(flushStreamBuffer);
  }
}

function appendToolCall(name, inputJson) {
  if (!state.currentMsgId) return;
  const msg = state.messages.find(m => m.id === state.currentMsgId);
  if (!msg) return;
  state.toolCallCount++;
  msg.toolCalls.push({ name, inputJson, status: 'running' });
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

function startStreaming() {
  state.streaming = true;
  const msg = { id: mkId(), role: 'assistant', content: '', toolCalls: [], timestamp: new Date().toISOString() };
  state.messages.push(msg);
  state.currentMsgId = msg.id;
  state._streamBuffer = '';
  DOM.messages.appendChild(renderMessage(msg));
  DOM.typingIndicator.classList.add('visible');
  DOM.stopBtn.classList.add('visible');
  DOM.sendBtn.style.display = 'none';
  DOM.inputArea.classList.add('locked');
  DOM.textarea.disabled = true;
}

function endStreaming() {
  state.streaming = false;
  if (state._rafPending) {
    state._rafPending = false;
    const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
    if (msgEl) {
      const cd = msgEl.querySelector('.msg-content');
      if (cd) cd.innerHTML = window.marked.parse(state._streamBuffer);
    }
  }
  const msg = state.messages.find(m => m.id === state.currentMsgId);
  if (msg) {
    msg.content = state._streamBuffer;
    msg.toolCalls.forEach(tc => { if (tc.status === 'running') tc.status = 'done'; });
    const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
    if (msgEl) {
      msgEl.querySelectorAll('.tool-status.running').forEach(el => {
        el.className = 'tool-status done'; el.textContent = '✓ done';
      });
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
  state.pendingAttachments = [];
  renderPendingAttachments();

  startStreaming();
  bridge.sendMessage(text, JSON.stringify(attachments));
}

// ── Sessions ───────────────────────────────────────────────────────────────
function renderSessions(sessions) {
  state.sessions = (sessions || []).sort((a, b) => b.timestamp - a.timestamp);
  DOM.sessionList.innerHTML = '';
  if (!state.sessions.length) {
    DOM.sessionList.innerHTML = '<div class="session-empty">No conversations yet</div>';
    return;
  }
  state.sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '');
    item.dataset.sid = s.id;
    item.innerHTML = `<div class="session-preview">${escHtml(s.preview)}</div><div class="session-time">${relativeTime(s.timestamp)}</div>`;
    item.addEventListener('click', () => {
      state.activeSessionId = s.id;
      DOM.sessionList.querySelectorAll('.session-item').forEach(el => el.classList.toggle('active', el.dataset.sid === s.id));
      bridge.loadSession(s.id);
    });
    DOM.sessionList.appendChild(item);
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

function syncModel(val) {
  state.model = val;
  const found = MODELS.find(m => m.value === val || (m.value && val && val.toLowerCase().includes(m.value)));
  DOM.modelBtnLabel.textContent = found?.label || val || 'Default';
}

function syncYolo(enabled) {
  state.yolo = !!enabled;
  DOM.yoloBtn.textContent = state.yolo ? 'YOLO' : 'Safe';
  DOM.yoloBtn.classList.toggle('yolo-on', state.yolo);
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
  const { inputTokens = 0, outputTokens = 0, contextWindow = 0, numTurns = 0 } = data;

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

// ── Events ─────────────────────────────────────────────────────────────────
function wireEvents() {
  DOM.sidebarToggle.addEventListener('click', toggleSidebar);

  DOM.textarea.addEventListener('input', () => {
    DOM.textarea.style.height = 'auto';
    DOM.textarea.style.height = Math.min(DOM.textarea.scrollHeight, 200) + 'px';
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

  // Attach button
  DOM.attachBtn.addEventListener('click', () => { if (bridge) bridge.pickImages(); });

  // Image preview modal close
  DOM.imagePreviewClose.addEventListener('click', () => DOM.imagePreviewModal.classList.remove('visible'));
  DOM.imagePreviewModal.addEventListener('click', (e) => {
    if (e.target === DOM.imagePreviewModal) DOM.imagePreviewModal.classList.remove('visible');
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

function wireBridgeSignals() {
  bridge.textReady.connect(text => appendToken(text));
  bridge.toolUse.connect((name, inputJson) => appendToolCall(name, inputJson));
  bridge.turnComplete.connect(() => { if (state.streaming) endStreaming(); });
  bridge.errorOccurred.connect(msg => {
    if (state.streaming) endStreaming();
    const errMsg = { id: mkId(), role: 'assistant', content: `**Error:** ${escHtml(msg)}`, toolCalls: [], timestamp: new Date().toISOString() };
    state.messages.push(errMsg);
    DOM.messages.appendChild(renderMessage(errMsg));
  });
  bridge.sessionReady.connect(id => {
    state.activeSessionId = id;
    if (!id) resetStatusline();
    bridge.requestSessions();
  });
  bridge.sessionsListed.connect(json => { try { renderSessions(JSON.parse(json)); } catch {} });
  bridge.sessionHistoryLoaded.connect(json => { try { loadSessionHistory(JSON.parse(json)); } catch {} });
  bridge.cwdChanged.connect(path => { syncCwd(path); state.activeSessionId = ''; resetStatusline(); bridge.requestSessions(); });
  bridge.modelChanged.connect(model => { syncModel(model); syncStatuslineModel(model); });
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
  bridge.usageUpdated.connect(json => onUsageUpdated(json));
  syncCwd(bridge.cwd);
  syncModel(bridge.model);
  syncStatuslineModel(bridge.model);
  syncYolo(bridge.yolo);
  bridge.requestSessions();
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
    wireBridgeSignals();
  });
})();
