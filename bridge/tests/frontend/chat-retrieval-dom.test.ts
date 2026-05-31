import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject } from '../../../resources/chat/chat-projects.js';

class FakeClassList {
  private tokens = new Set<string>();

  constructor(private element: FakeElement) {}

  add(...names: string[]) {
    names.filter(Boolean).forEach(name => this.tokens.add(name));
    this.sync();
  }

  remove(...names: string[]) {
    names.forEach(name => this.tokens.delete(name));
    this.sync();
  }

  toggle(name: string, force?: boolean) {
    if (force === true) {
      this.tokens.add(name);
    } else if (force === false) {
      this.tokens.delete(name);
    } else if (this.tokens.has(name)) {
      this.tokens.delete(name);
    } else {
      this.tokens.add(name);
    }
    this.sync();
    return this.tokens.has(name);
  }

  contains(name: string) {
    return this.tokens.has(name);
  }

  setFromString(value: string) {
    this.tokens = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this.sync();
  }

  toString() {
    return [...this.tokens].join(' ');
  }

  private sync() {
    this.element._className = this.toString();
  }
}

class FakeElement {
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  hidden = false;
  disabled = false;
  value = '';
  type = '';
  title = '';
  _className = '';
  private _id = '';
  private _innerHTML = '';
  private _textContent = '';
  private listeners = new Map<string, Array<(event: any) => void>>();
  readonly classList = new FakeClassList(this);

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  set id(value: string) {
    this._id = String(value || '');
    if (this._id) this.ownerDocument.elementsById.set(this._id, this);
  }

  get id() {
    return this._id;
  }

  set className(value: string) {
    this.classList.setFromString(value);
  }

  get className() {
    return this._className;
  }

  set innerHTML(value: string) {
    this._innerHTML = String(value || '');
    this._textContent = '';
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML + this.children.map(child => child.outerHTML()).join('');
  }

  set textContent(value: string) {
    this._textContent = String(value || '');
    this._innerHTML = '';
    this.children = [];
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return stripTags(this._innerHTML) + this.children.map(child => child.textContent).join('');
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: Array<FakeElement | string>) {
    nodes.forEach(node => {
      if (typeof node === 'string') {
        const textNode = this.ownerDocument.createElement('span');
        textNode.textContent = node;
        this.appendChild(textNode);
      } else {
        this.appendChild(node);
      }
    });
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  addEventListener(type: string, handler: (event: any) => void) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  dispatchEvent(event: any) {
    event.target ||= this;
    event.currentTarget = this;
    event.stopPropagation ||= (() => {});
    event.preventDefault ||= (() => {});
    const list = this.listeners.get(event.type) || [];
    list.forEach(handler => handler(event));
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  setAttribute(name: string, value: string) {
    if (name === 'id') {
      this.id = value;
      return;
    }
    if (name === 'class') {
      this.className = value;
      return;
    }
    if (name.startsWith('data-')) {
      this.dataset[toCamel(name.slice(5))] = value;
      return;
    }
    (this as any)[name] = value;
  }

  getAttribute(name: string) {
    if (name === 'id') return this.id;
    if (name === 'class') return this.className;
    if (name.startsWith('data-')) return this.dataset[toCamel(name.slice(5))] || null;
    return (this as any)[name] || null;
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string) {
    const selectors = selector.split(',').map(part => part.trim()).filter(Boolean);
    const matches: FakeElement[] = [];
    walkChildren(this, child => {
      if (selectors.some(part => elementMatches(child, part))) {
        matches.push(child);
      }
    });
    return matches;
  }

  closest(selector: string) {
    let current: FakeElement | null = this;
    while (current) {
      if (elementMatches(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  scrollIntoView() {}

  focus() {}

  select() {}

  outerHTML() {
    const attrs = [
      this.id ? ` id="${this.id}"` : '',
      this.className ? ` class="${this.className}"` : '',
    ].join('');
    const content = this._innerHTML || this._textContent || this.children.map(child => child.outerHTML()).join('');
    return `<${this.tagName}${attrs}>${content}</${this.tagName}>`;
  }
}

class FakeDocument {
  readonly body = new FakeElement(this, 'body');
  readonly elementsById = new Map<string, FakeElement>();

  createElement(tagName: string) {
    return new FakeElement(this, tagName.toLowerCase());
  }

  getElementById(id: string) {
    return this.elementsById.get(id) || null;
  }

  querySelector(selector: string) {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string) {
    return this.body.querySelectorAll(selector);
  }

  execCommand() {
    return true;
  }
}

function walkChildren(root: FakeElement, visit: (child: FakeElement) => void) {
  root.children.forEach(child => {
    visit(child);
    walkChildren(child, visit);
  });
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function toCamel(value: string) {
  return value.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function elementMatches(element: FakeElement, selector: string) {
  if (!selector) return false;
  if (selector.startsWith('.')) {
    return element.classList.contains(selector.slice(1));
  }
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const name = selector.slice(1, -1);
    if (name.startsWith('data-')) return !!element.getAttribute(name);
    return false;
  }
  return element.tagName === selector.toLowerCase();
}

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

function createTestDom(document: FakeDocument) {
  const messages = document.createElement('div');
  const knowledgeRailCount = document.createElement('div');
  const knowledgeSuggestions = document.createElement('div');
  const knowledgeRecords = document.createElement('div');
  const cwdBtn = document.createElement('button');
  const inputArea = document.createElement('div');
  const attachmentTray = document.createElement('div');
  const typingIndicator = document.createElement('div');
  const statusline = document.createElement('div');
  const scrollToBottomBtn = document.createElement('button');
  const searchBar = document.createElement('div');
  const globalSearchInput = document.createElement('input');
  const searchInput = document.createElement('input');
  const globalSearchClear = document.createElement('button');

  document.body.append(
    messages,
    knowledgeRailCount,
    knowledgeSuggestions,
    knowledgeRecords,
    cwdBtn,
    inputArea,
    attachmentTray,
    typingIndicator,
    statusline,
    scrollToBottomBtn,
    searchBar,
    globalSearchInput,
    searchInput,
    globalSearchClear,
  );

  return {
    messages,
    knowledgeRailCount,
    knowledgeSuggestions,
    knowledgeRecords,
    cwdBtn,
    inputArea,
    attachmentTray,
    typingIndicator,
    statusline,
    scrollToBottomBtn,
    searchBar,
    globalSearchInput,
    searchInput,
    globalSearchClear,
  };
}

async function loadChatModule() {
  const document = new FakeDocument();
  const localStorage = makeStorage();
  const windowObject = {
    __CHAT_DISABLE_BOOTSTRAP__: true,
    marked: {
      use: vi.fn(),
      parse: (value: string) => value,
    },
  };
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

  Object.assign(globalThis, {
    document,
    localStorage,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    window: windowObject,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard },
  });
  Object.defineProperty(globalThis, '__CHAT_DISABLE_BOOTSTRAP__', {
    configurable: true,
    value: true,
  });

  const moduleUrl = new URL(`../../../resources/chat/chat.js?dom-test=${Date.now()}-${Math.random()}`, import.meta.url);
  const chatModule = await import(moduleUrl.href);

  return {
    chatModule,
    document,
    dom: createTestDom(document),
  };
}

function buildRecordResult(project: ReturnType<typeof createDefaultProject>) {
  return {
    id: 'record:rec-1',
    kind: 'record',
    type: 'artifact',
    title: 'Shared cache guide',
    snippet: 'Use cache v2 everywhere',
    state: 'reviewed',
    projectId: project.id,
    projectName: project.name,
    projectCwd: project.cwd,
    sessionId: 'sess-b',
    messageId: 'msg-b',
    timestamp: '2026-05-31T00:00:00Z',
    matchScore: 5,
    trustTier: 1,
    source: { sessionId: 'sess-b', messageId: 'msg-b', role: 'assistant', index: 2 },
  };
}

function findButtonByLabel(root: FakeElement, label: string) {
  return root.querySelectorAll('button').find(button => button.textContent === label) || null;
}

describe('retrieval preview DOM flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a preview card when a result card is clicked', async () => {
    const { chatModule, dom } = await loadChatModule();
    const hooks = chatModule.__testHooks;
    const alpha = createDefaultProject('/tmp/alpha');
    const beta = createDefaultProject('/tmp/beta');
    const result = buildRecordResult(beta);

    hooks.setDom(dom);
    hooks.setBridge({
      copyToClipboard: vi.fn(),
      loadSession: vi.fn(),
      setCwd: vi.fn(),
    });
    hooks.state.projects = [alpha, beta];
    hooks.state.activeProjectId = alpha.id;
    hooks.state.activeSection = 'explore';
    hooks.state.retrievalQuery = 'cache';
    hooks.state.retrievalResults = [result];
    hooks.state.retrievalGroups = [{ key: 'records', label: 'Related records', items: [result] }];
    hooks.syncCwd(alpha.cwd);

    hooks.renderExploreResults();
    const resultCard = dom.messages.querySelector('.explore-result-card');
    expect(resultCard).not.toBeNull();

    resultCard?.click();

    const previewCard = dom.knowledgeRecords.querySelector('.explore-preview-card');
    expect(previewCard?.innerHTML).toContain('Shared cache guide');
    expect(findButtonByLabel(dom.knowledgeRecords, 'Open source')).not.toBeNull();
    expect(findButtonByLabel(dom.knowledgeRecords, 'Open project')).not.toBeNull();
    expect(findButtonByLabel(dom.knowledgeRecords, 'Copy link')).not.toBeNull();
  });

  it('copies a stable retrieval deep link from the preview', async () => {
    const { chatModule, dom } = await loadChatModule();
    const hooks = chatModule.__testHooks;
    const alpha = createDefaultProject('/tmp/alpha');
    const beta = createDefaultProject('/tmp/beta');
    const result = buildRecordResult(beta);
    const bridge = {
      copyToClipboard: vi.fn(),
      loadSession: vi.fn(),
      setCwd: vi.fn(),
    };

    hooks.setDom(dom);
    hooks.setBridge(bridge);
    hooks.state.projects = [alpha, beta];
    hooks.state.activeProjectId = alpha.id;
    hooks.state.activeSection = 'explore';
    hooks.state.retrievalQuery = 'cache';
    hooks.state.retrievalResults = [result];
    hooks.state.retrievalGroups = [{ key: 'records', label: 'Related records', items: [result] }];
    hooks.syncCwd(alpha.cwd);

    hooks.renderExploreResults();
    dom.messages.querySelector('.explore-result-card')?.click();
    findButtonByLabel(dom.knowledgeRecords, 'Copy link')?.click();

    expect(bridge.copyToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('claudian://retrieval?'),
    );
    const copied = bridge.copyToClipboard.mock.calls[0][0];
    expect(copied).toContain('project=%2Ftmp%2Fbeta');
    expect(copied).toContain('kind=record');
    expect(copied).toContain('resultId=record%3Arec-1');
    expect(copied).toContain('sessionId=sess-b');
    expect(copied).toContain('messageId=msg-b');
    expect(copied).toContain('sourceIndex=2');
  });

  it('hands off across projects before opening the source session with exact provenance', async () => {
    const { chatModule, dom } = await loadChatModule();
    const hooks = chatModule.__testHooks;
    const alpha = createDefaultProject('/tmp/alpha');
    const beta = createDefaultProject('/tmp/beta');
    const result = buildRecordResult(beta);
    const bridge = {
      copyToClipboard: vi.fn(),
      loadSession: vi.fn(),
      setCwd: vi.fn(),
    };

    hooks.setDom(dom);
    hooks.setBridge(bridge);
    hooks.setRuntimeHooks({
      renderProjectShell: () => {},
      renderMessages: () => {},
      saveActiveProjectId: () => {},
    });
    hooks.state.projects = [alpha, beta];
    hooks.state.activeProjectId = alpha.id;
    hooks.state.activeSection = 'explore';
    hooks.state.retrievalQuery = 'cache';
    hooks.state.retrievalResults = [result];
    hooks.state.retrievalGroups = [{ key: 'records', label: 'Related records', items: [result] }];
    hooks.syncCwd(alpha.cwd);

    hooks.renderExploreResults();
    dom.messages.querySelector('.explore-result-card')?.click();
    findButtonByLabel(dom.knowledgeRecords, 'Open source')?.click();

    expect(bridge.setCwd).toHaveBeenCalledWith('/tmp/beta');
    expect(bridge.loadSession).not.toHaveBeenCalled();

    hooks.syncCwd(beta.cwd);
    hooks.flushPendingResultNavigation();

    expect(bridge.loadSession).toHaveBeenCalledWith('sess-b');
    expect(hooks.state.activeSection).toBe('worklog');
    expect(hooks.state.pendingSearch).toEqual({
      sessionId: 'sess-b',
      messageId: 'msg-b',
      sourceIndex: 2,
      excerpt: 'Use cache v2 everywhere',
    });
  });

  it('switches project context on preview open-project actions after the cwd handoff', async () => {
    const { chatModule, dom } = await loadChatModule();
    const hooks = chatModule.__testHooks;
    const alpha = createDefaultProject('/tmp/alpha');
    const beta = createDefaultProject('/tmp/beta');
    const result = buildRecordResult(beta);
    const bridge = {
      copyToClipboard: vi.fn(),
      loadSession: vi.fn(),
      setCwd: vi.fn(),
    };

    hooks.setDom(dom);
    hooks.setBridge(bridge);
    hooks.setRuntimeHooks({
      renderProjectShell: () => {},
      renderMessages: () => {},
      saveActiveProjectId: () => {},
    });
    hooks.state.projects = [alpha, beta];
    hooks.state.activeProjectId = alpha.id;
    hooks.state.activeSection = 'explore';
    hooks.state.retrievalQuery = 'cache';
    hooks.state.retrievalResults = [result];
    hooks.state.retrievalGroups = [{ key: 'records', label: 'Related records', items: [result] }];
    hooks.syncCwd(alpha.cwd);

    hooks.renderExploreResults();
    dom.messages.querySelector('.explore-result-card')?.click();
    findButtonByLabel(dom.knowledgeRecords, 'Open project')?.click();

    expect(bridge.setCwd).toHaveBeenCalledWith('/tmp/beta');

    hooks.syncCwd(beta.cwd);
    hooks.flushPendingResultNavigation();

    expect(hooks.state.activeProjectId).toBe(beta.id);
    expect(hooks.state.activeSection).toBe('artifacts');
    expect(bridge.loadSession).not.toHaveBeenCalled();
  });
});
