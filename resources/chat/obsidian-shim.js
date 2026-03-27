// obsidian-shim.js — Minimal Obsidian API mock for running ClaudianPlugin
// in a plain browser / Qt WebEngine context (no Obsidian, no Node.js).

// ── CommonJS glue ─────────────────────────────────────────────────────────
// main.js is an esbuild CommonJS bundle; it ends with `module.exports = ...`
window.global  = window;          // Node.js global alias
window.module  = { exports: {} };
window.exports = window.module.exports;

window.process = {
  env: { NODE_ENV: 'production' },
  platform: 'darwin',
  versions: { node: '18.0.0' },
  cwd: () => '/',
  nextTick: (fn, ...a) => setTimeout(() => fn(...a), 0),
};

window.require = function shimRequire(name) {
  switch (name) {
    case 'obsidian': return window.__obsidian__;
    case 'electron': return {
      remote: null,
      ipcRenderer: { on(){}, once(){}, send(){}, removeListener(){} },
      shell: { openExternal(){} },
    };
    case 'path': return {
      join:     (...p) => p.join('/').replace(/\/{2,}/g, '/'),
      dirname:  (p)    => p.split('/').slice(0, -1).join('/') || '/',
      basename: (p, e) => { const b = p.split('/').pop(); return e && b.endsWith(e) ? b.slice(0,-e.length) : b; },
      extname:  (p)    => { const b = p.split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
      resolve:  (...p) => p.join('/'),
      sep: '/',
      posix:    { sep: '/', join: (...p) => p.join('/') },
    };
    case 'fs': return {
      existsSync: ()  => false,
      readFileSync: () => '',
      writeFileSync: () => {},
      mkdirSync: ()   => {},
      promises: {
        access:   ()     => Promise.resolve(),
        readFile: (p)    => Promise.resolve(''),
        writeFile: ()    => Promise.resolve(),
        mkdir:    ()     => Promise.resolve(),
        readdir:  ()     => Promise.resolve([]),
        stat:     ()     => Promise.resolve({ isDirectory: () => true, isFile: () => false, size: 0 }),
        unlink:   ()     => Promise.resolve(),
        rmdir:    ()     => Promise.resolve(),
      },
    };
    case 'os': return {
      homedir:  () => '/',
      platform: () => 'darwin',
      tmpdir:   () => '/tmp',
      hostname: () => 'localhost',
      type:     () => 'Darwin',
      release:  () => '0.0.0',
      arch:     () => 'arm64',
      cpus:     () => [],
      totalmem: () => 0,
      freemem:  () => 0,
      EOL:      '\n',
    };
    case 'child_process': return {
      spawn:  () => ({ stdout: { on(){} }, stderr: { on(){} }, on(){}, kill(){} }),
      exec:   (cmd, opts, cb) => { if (cb) cb(null, '', ''); return { kill(){} }; },
      execSync: () => '',
    };
    case 'stream': return {
      Readable: class { pipe(){return this;} on(){return this;} },
      Transform: class { pipe(){return this;} on(){return this;} },
    };
    case 'events': {
      function EventEmitter() { this._ev = {}; }
      EventEmitter.prototype.on = function(e,fn){ (this._ev[e]=this._ev[e]||[]).push(fn); return this; };
      EventEmitter.prototype.once = function(e,fn){ const w=(...a)=>{fn(...a);this.off(e,w);}; return this.on(e,w); };
      EventEmitter.prototype.off = function(e,fn){ if(this._ev[e]) this._ev[e]=this._ev[e].filter(f=>f!==fn); return this; };
      EventEmitter.prototype.emit = function(e,...a){ (this._ev[e]||[]).slice().forEach(f=>f(...a)); };
      EventEmitter.prototype.removeAllListeners = function(e){ if(e) delete this._ev[e]; else this._ev={}; return this; };
      EventEmitter.prototype.setMaxListeners = function(){ return this; };
      EventEmitter.prototype.listeners = function(e){ return (this._ev[e]||[]).slice(); };
      function setMaxListeners() {}
      setMaxListeners.__electronPatched = true;  // pre-patch so patchSetMaxListenersForElectron is a no-op
      return { EventEmitter, setMaxListeners, once: (e,fn)=>{}, on: (e,fn)=>{} };
    }
    case 'http': case 'https': return { request: () => ({ on(){}, end(){} }), get: () => ({ on(){}, end(){} }) };
    case 'net':  return { connect: () => ({ on(){}, write(){}, destroy(){} }) };
    case 'tls':  return { connect: () => ({ on(){}, write(){}, destroy(){} }) };
    case 'url':  return { URL: window.URL, parse: (u) => new URL(u) };
    case 'util': return {
      promisify: (fn) => (...args) => new Promise((res, rej) => fn(...args, (err, val) => err ? rej(err) : res(val))),
      inspect:   (v) => String(v),
      format:    (...a) => a.map(String).join(' '),
      inherits:  (ctor, super_) => { ctor.prototype = Object.create(super_.prototype); ctor.prototype.constructor = ctor; },
      deprecate: (fn) => fn,
      types:     { isPromise: (v) => v instanceof Promise, isRegExp: (v) => v instanceof RegExp },
    };
    case 'assert': return { ok(){}, strictEqual(){}, deepEqual(){} };
    case 'buffer': return { Buffer: window.Buffer || { from: (d) => d, alloc: (n) => new Uint8Array(n) } };
    case 'crypto': return {
      // Wrap native methods so indirect calls like (0, crypto.randomUUID)() keep `this`
      randomUUID:       ()  => window.crypto.randomUUID(),
      getRandomValues:  (a) => window.crypto.getRandomValues(a),
      subtle:           window.crypto.subtle,
      randomBytes:      (n) => { const a = new Uint8Array(n); window.crypto.getRandomValues(a); return a; },
      createHash:       ()  => ({ update() { return this; }, digest: () => '' }),
      createHmac:       ()  => ({ update() { return this; }, digest: () => '' }),
    };
    // CodeMirror — used for editor features; stub so they don't throw
    case '@codemirror/state':
      return {
        StateEffect: { define: function() { var e = { is: function(x) { return x === e; } }; return e; } },
        StateField: { define: function(s) { return { _spec: s }; } },
        RangeSetBuilder: function() { this.ranges = []; },
        EditorState: { create: function() { return { doc: { length: 0, toString: function() { return ''; } }, selection: null }; } },
        Transaction: {},
        Compartment: function() {},
        Facet: { define: function() { return { of: function() { return {}; } }; } },
        Annotation: { define: function() { return {}; } },
        ChangeDesc: {},
      };
    case '@codemirror/view':
      return {
        Decoration: { none: {}, mark: function() { return {}; }, widget: function() { return {}; }, replace: function() { return {}; }, set: function() { return {}; } },
        ViewPlugin: { fromClass: function() { return {}; } },
        EditorView: function() {},
        WidgetType: function() {},
        showTooltip: {},
        tooltips: {},
        placeholder: function() { return {}; },
        keymap: { of: function() { return {}; } },
        lineNumbers: function() { return {}; },
        drawSelection: function() { return {}; },
      };
    case '@codemirror/language': return { syntaxHighlighting: function() { return {}; }, HighlightStyle: { define: function() { return {}; } }, defaultHighlightStyle: {}, StreamLanguage: { define: function() { return {}; } } };
    case '@codemirror/commands': return { defaultKeymap: [], history: function() { return {}; }, undo: function() {}, redo: function() {} };
    case '@codemirror/autocomplete': return { autocompletion: function() { return {}; }, completionKeymap: [] };
    case '@codemirror/search': return { searchKeymap: [], search: function() { return {}; } };
    case '@lezer/common': return { NodeType: { define: function() { return {}; } }, Tree: {} };
    case '@lezer/highlight': return { tags: {}, classHighlighter: {}, tagHighlighter: function() { return {}; } };
    default:
      return {};
  }
};

// ── HTMLElement extensions (Obsidian DOM helpers) ─────────────────────────
(function patchDOM() {
  function applyOpts(el, opts) {
    if (!opts) return el;
    if (typeof opts === 'string') { el.className = opts; return el; }
    const { cls, text, attr, title, placeholder, type, value, href, id } = opts;
    if (cls)         el.className   = Array.isArray(cls) ? cls.join(' ') : cls;
    if (text != null) el.textContent = text;
    if (attr)        Object.entries(attr).forEach(([k, v]) => v != null ? el.setAttribute(k, v) : el.removeAttribute(k));
    if (title)       el.setAttribute('title', title);
    if (placeholder) el.setAttribute('placeholder', placeholder);
    if (type)        el.setAttribute('type', type);
    if (value != null) el.setAttribute('value', value);
    if (href)        el.setAttribute('href', href);
    if (id)          el.id = id;
    return el;
  }

  const proto = HTMLElement.prototype;

  proto.createEl = function(tag, opts) {
    const el = document.createElement(tag);
    applyOpts(el, opts);
    this.appendChild(el);
    return el;
  };
  proto.createDiv    = function(opts)       { return this.createEl('div',      opts); };
  proto.createSpan   = function(opts)       { return this.createEl('span',     opts); };
  proto.createButton = function(opts)       { return this.createEl('button',   opts); };

  proto.createSvgEl = function(tag, opts) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (opts?.cls)  el.setAttribute('class', opts.cls);
    if (opts?.attr) Object.entries(opts.attr).forEach(([k, v]) => el.setAttribute(k, v));
    this.appendChild(el);
    return el;
  };

  proto.empty = function()          { while (this.firstChild) this.removeChild(this.firstChild); return this; };
  proto.setText = function(t)       { this.textContent = t ?? ''; return this; };
  proto.setAttr = function(k, v)    { v != null ? this.setAttribute(k, v) : this.removeAttribute(k); return this; };
  proto.removeAttr = function(k)    { this.removeAttribute(k); return this; };
  proto.getAttr = function(k)       { return this.getAttribute(k); };
  proto.hasAttr = function(k)       { return this.hasAttribute(k); };

  proto.addClass    = function(cls) {
    if (!cls) return this;
    const list = Array.isArray(cls) ? cls : cls.split(/\s+/).filter(Boolean);
    list.length && this.classList.add(...list);
    return this;
  };
  proto.removeClass = function(cls) {
    if (!cls) return this;
    const list = Array.isArray(cls) ? cls : cls.split(/\s+/).filter(Boolean);
    list.length && this.classList.remove(...list);
    return this;
  };
  proto.toggleClass = function(cls, v) {
    if (typeof v === 'boolean') this.classList.toggle(cls, v);
    else this.classList.toggle(cls);
    return this;
  };
  proto.hasClass = function(cls)    { return this.classList.contains(cls); };

  proto.find    = function(sel)     { return this.querySelector(sel); };
  proto.findAll = function(sel)     { return Array.from(this.querySelectorAll(sel)); };

  // Also patch DocumentFragment (used internally by Obsidian)
  const fp = DocumentFragment.prototype;
  ['createEl','createDiv','createSpan','createButton','empty','setText',
   'setAttr','getAttr','addClass','removeClass','toggleClass','hasClass',
   'find','findAll'].forEach(m => { fp[m] = proto[m]; });
})();

// ── Simple markdown renderer (used by MarkdownRenderer.renderMarkdown mock) ─
window.__renderMarkdown = function renderMarkdown(text) {
  const esc = s => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const parts = text.split(/(```[\s\S]*?```)/g);
  let html = '';
  for (const part of parts) {
    if (part.startsWith('```')) {
      const inner = part.slice(3, -3);
      const nl    = inner.indexOf('\n');
      const lang  = nl > 0 ? inner.slice(0, nl).trim() : '';
      const code  = nl > 0 ? inner.slice(nl + 1) : inner;
      html +=
        `<div class="claudian-code-wrapper${lang ? ' has-language' : ''}">` +
        (lang ? `<span class="claudian-code-lang-label">${esc(lang)}</span>` : '') +
        `<pre><code>${esc(code)}</code></pre></div>`;
    } else {
      let s = esc(part);
      s = s.replace(/`([^`\n]+)`/g,    '<code class="claudian-inline-code">$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*([^*\n]+)\*/g,   '<em>$1</em>');
      s = s.replace(/^### (.+)$/gm,     '<h3>$1</h3>');
      s = s.replace(/^## (.+)$/gm,      '<h2>$1</h2>');
      s = s.replace(/^# (.+)$/gm,       '<h1>$1</h1>');
      s = s.replace(/^[-*] (.+)$/gm,    '<li>$1</li>');
      s = s.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
      s = s.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul style="padding-left:18px;margin:4px 0">$1</ul>');
      s = s.replace(/\n\n+/g, '</p><p>');
      s = s.replace(/\n/g,    '<br>');
      html += `<p>${s}</p>`;
    }
  }
  return html;
};

// ── Obsidian API mock ─────────────────────────────────────────────────────
window.__obsidian__ = (function buildObsidianMock() {

  // ── Component ──────────────────────────────────────────────────────────
  class Component {
    constructor() { this._children = []; this._cleanup = []; }
    load()   { this.onload?.(); }
    unload() { this._cleanup.forEach(fn => { try { fn(); } catch {} }); this._children.forEach(c => c.unload?.()); this.onunload?.(); }
    onload()   {}
    onunload() {}
    addChild(c)    { this._children.push(c); c.load?.(); return c; }
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i,1); return c; }
    register(fn)   { this._cleanup.push(fn); }
    registerEvent(ref) { this._cleanup.push(() => ref?.unsubscribe?.()); return ref; }
    registerDomEvent(el, type, fn, opts) {
      el.addEventListener(type, fn, opts);
      this.register(() => el.removeEventListener(type, fn, opts));
    }
    registerInterval(id) { this.register(() => clearInterval(id)); }
  }

  // ── Plugin ─────────────────────────────────────────────────────────────
  class Plugin extends Component {
    constructor(app, manifest) {
      super();
      this.app      = app;
      this.manifest = manifest;
      this._viewFactories = {};
    }
    registerView(type, factory)   { this._viewFactories[type] = factory; }
    addRibbonIcon(icon, title, cb) {
      const btn = document.createElement('button');
      btn.title = title; btn.setAttribute('aria-label', title);
      if (cb) btn.addEventListener('click', cb);
      return btn;
    }
    addCommand(cmd)      { return cmd; }
    addSettingTab(tab)   {}
    async loadData()     { return {}; }
    async saveData(data) {}
    registerEvent(ref)   { return ref; }
    registerMarkdownCodeBlockProcessor() {}
    registerMarkdownPostProcessor()      {}
    registerEditorExtension()            {}
    registerEditorSuggest()              {}
  }

  // ── ItemView ───────────────────────────────────────────────────────────
  class ItemView extends Component {
    constructor(leaf) {
      super();
      this.leaf        = leaf;
      this.app         = leaf?.app || null;
      this.containerEl = (leaf && leaf.containerEl) || document.createElement('div');
      this.contentEl   = this.containerEl.createDiv({ cls: 'view-content' });
      this.icon        = '';
      this.navigation  = false;
    }
    getViewType()    { return ''; }
    getDisplayText() { return ''; }
    getIcon()        { return this.icon; }
    async onOpen()   {}
    async onClose()  {}
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  class Modal {
    constructor(app) {
      this.app        = app;
      this.containerEl = document.createElement('div');
      this.modalEl     = this.containerEl;
      this.contentEl   = this.containerEl.createDiv({ cls: 'modal-content' });
      this.titleEl     = this.containerEl.createDiv({ cls: 'modal-title' });
    }
    open()    {}
    close()   {}
    onOpen()  {}
    onClose() {}
  }

  // ── Setting ────────────────────────────────────────────────────────────
  class Setting {
    constructor(container) {
      this.el = container ? container.createDiv({ cls: 'setting-item' }) : document.createElement('div');
    }
    setName(n)    { return this; }
    setDesc(d)    { return this; }
    setClass(c)   { if (c) this.el.addClass(c); return this; }
    setHeading()  { return this; }
    setDisabled() { return this; }
    then(cb)      { cb(this); return this; }
    clear()       { return this; }
    addText(cb)       { const c = this._ctrl(); cb?.(c); return this; }
    addTextArea(cb)   { const c = this._ctrl(); cb?.(c); return this; }
    addToggle(cb)     { const c = this._ctrl(false); cb?.(c); return this; }
    addDropdown(cb)   { const c = this._ctrl('', { addOption(){return c;} }); cb?.(c); return this; }
    addButton(cb)     { const c = this._ctrl('', { setButtonText(t){return c;}, setCta(){return c;}, setWarning(){return c;} }); cb?.(c); return this; }
    addSlider(cb)     { const c = this._ctrl(0, { setLimits(){return c;}, setDynamicTooltip(){return c;} }); cb?.(c); return this; }
    addMomentFormat(cb){ const c = this._ctrl(); cb?.(c); return this; }
    addColorPicker(cb){ const c = this._ctrl(); cb?.(c); return this; }
    addExtraButton(cb){ const c = { setIcon(){return c;}, setTooltip(){return c;}, onClick(){return c;}, setDisabled(){return c;} }; cb?.(c); return this; }
    addSearch(cb)     { const c = this._ctrl(); cb?.(c); return this; }
    _ctrl(dflt, extra) {
      let v = dflt ?? '';
      const c = { ...extra, inputEl: document.createElement('input'), setValue(x){v=x;return c;}, getValue(){return v;}, onChange(fn){return c;}, setPlaceholder(){return c;}, setDisabled(){return c;} };
      return c;
    }
  }

  // ── PluginSettingTab ───────────────────────────────────────────────────
  class PluginSettingTab extends Component {
    constructor(app, plugin) { super(); this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); }
    display() {}
    hide()    {}
  }

  // ── SuggestModal / FuzzySuggestModal ───────────────────────────────────
  class SuggestModal extends Modal {
    constructor(app) { super(app); }
    getSuggestions() { return []; }
    renderSuggestion() {}
    onChooseSuggestion() {}
  }

  class FuzzySuggestModal extends SuggestModal {
    getItems() { return []; }
    getItemText() { return ''; }
    onChooseItem() {}
  }

  // ── TFile / TFolder ────────────────────────────────────────────────────
  class TAbstractFile { constructor() { this.name=''; this.path=''; this.parent=null; } }
  class TFile extends TAbstractFile {
    constructor(path='') {
      super();
      this.path      = path;
      this.name      = path.split('/').pop();
      this.extension = (this.name.match(/\.([^.]+)$/) || [])[1] || '';
      this.basename  = this.name.slice(0, this.name.length - (this.extension ? this.extension.length+1 : 0));
      this.stat      = { mtime: 0, ctime: 0, size: 0 };
    }
  }
  class TFolder extends TAbstractFile {
    constructor(path='') { super(); this.path = path; this.name = path.split('/').pop(); this.children = []; this.isRoot = () => path === '/'; }
  }

  // ── Notice ─────────────────────────────────────────────────────────────
  class Notice {
    constructor(msg, timeout) { console.info('[Notice]', msg); }
    hide()            {}
    setMessage(m)     { return this; }
  }

  // ── Menu ───────────────────────────────────────────────────────────────
  class Menu {
    constructor() { this._items = []; }
    addItem(cb)       { const it = this._item(); cb(it); this._items.push(it); return this; }
    addSeparator()    { return this; }
    showAtMouseEvent() {}
    showAtPosition()  {}
    hide()            {}
    close()           {}
    _item() {
      const it = { setTitle(){return it;}, setIcon(){return it;}, setSection(){return it;}, setChecked(){return it;}, onClick(){return it;}, setDisabled(){return it;}, setIsLabel(){return it;} };
      return it;
    }
  }

  // ── MarkdownRenderer ───────────────────────────────────────────────────
  const MarkdownRenderer = {
    renderMarkdown(src, el, sourcePath, component) {
      el.innerHTML = window.__renderMarkdown(src || '');
      return Promise.resolve();
    },
    render(app, src, el, sourcePath, component) {
      el.innerHTML = window.__renderMarkdown(src || '');
      return Promise.resolve();
    },
  };

  // ── setIcon / setTooltip ───────────────────────────────────────────────
  function setIcon(el, iconId) {
    if (!el) return;
    el.setAttribute('data-icon', iconId || '');
  }
  function setTooltip(el, tip, opts) {
    if (el) el.setAttribute('title', tip || '');
  }

  // ── Misc utilities ─────────────────────────────────────────────────────
  function normalizePath(p) { return p.replace(/\\/g, '/'); }
  function debounce(fn, wait, imm) {
    let t;
    return function(...a) {
      clearTimeout(t);
      if (imm && !t) fn.apply(this, a);
      t = setTimeout(() => { t = null; if (!imm) fn.apply(this, a); }, wait);
    };
  }
  function moment(v) {
    const d = v ? new Date(v) : new Date();
    return { format: () => d.toLocaleString(), toISOString: () => d.toISOString(), valueOf: () => d.getTime(), add: () => moment(), subtract: () => moment(), diff: () => 0, isBefore: () => false, isAfter: () => false };
  }
  function htmlToMarkdown(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }
  function sanitizeHTMLToDom(html) { const d = document.createElement('div'); d.innerHTML = html; return d; }
  function prepareFuzzySearch(query) { return (str) => str.includes(query) ? { score: 1, matches: [] } : null; }
  function prepareSimpleSearch(query) { return (str) => str.includes(query) ? { score: 1, matches: [] } : null; }
  function sortSearchResults() {}
  function renderMatches(el, text) { el.textContent = text; }
  function addIcon() {}
  function getIcon() { return null; }
  function requireApiVersion() { return true; }
  function requestUrl(opts) { return Promise.reject(new Error('requestUrl: not available')); }
  function parseFrontMatterTags() { return []; }
  function getAllTags() { return []; }
  function parseLinktext(link) { return { path: link, subpath: '' }; }
  function getLinkpath(link) { return link; }
  function stringifyYaml(obj) { return JSON.stringify(obj, null, 2); }
  function parseYaml(str) { try { return JSON.parse(str); } catch { return {}; } }

  const Platform = { isMobile: false, isDesktop: true, isMacOS: true, isWin: false, isLinux: false };
  class Keymap { static isModEvent(e) { return e.ctrlKey||e.metaKey; } static isModifier(e,m) { return m==='Mod'?(e.ctrlKey||e.metaKey):false; } }
  class Scope {
    constructor() { this.keys = []; }
    register(mods, key, fn) { const ref = { mods, key, fn }; this.keys.push(ref); return ref; }
    unregister(ref) { this.keys = this.keys.filter(k => k !== ref); }
  }

  // Stub text/toggle/etc components (some plugins instantiate these directly)
  class AbstractTextComponent { constructor(el) { this.inputEl = el || document.createElement('input'); } getValue(){return this.inputEl.value;} setValue(v){this.inputEl.value=v??'';return this;} onChange(cb){this.inputEl.addEventListener('input',()=>cb(this.inputEl.value));return this;} setPlaceholder(p){this.inputEl.placeholder=p;return this;} setDisabled(d){this.inputEl.disabled=!!d;return this;} }
  class TextComponent extends AbstractTextComponent { constructor(el){super(el?el.createEl('input'):document.createElement('input'));} }
  class TextAreaComponent { constructor(el){this.inputEl=(el?el.createEl('textarea',{}):document.createElement('textarea'));}  getValue(){return this.inputEl.value;} setValue(v){this.inputEl.value=v??'';return this;} onChange(cb){this.inputEl.addEventListener('input',()=>cb(this.inputEl.value));return this;} setPlaceholder(p){this.inputEl.placeholder=p;return this;} }
  class ToggleComponent { constructor(el){this.toggleEl=document.createElement('input');this.toggleEl.type='checkbox';if(el)el.appendChild(this.toggleEl);this._v=false;} getValue(){return this._v;} setValue(v){this._v=!!v;this.toggleEl.checked=!!v;return this;} onChange(cb){this.toggleEl.addEventListener('change',()=>cb(this.toggleEl.checked));return this;} setDisabled(d){this.toggleEl.disabled=!!d;return this;} }
  class SliderComponent { constructor(el){this.sliderEl=document.createElement('input');this.sliderEl.type='range';if(el)el.appendChild(this.sliderEl);} getValue(){return +this.sliderEl.value;} setValue(v){this.sliderEl.value=v;return this;} setLimits(mn,mx,st){this.sliderEl.min=mn;this.sliderEl.max=mx;this.sliderEl.step=st;return this;} setDynamicTooltip(){return this;} onChange(cb){this.sliderEl.addEventListener('input',()=>cb(+this.sliderEl.value));return this;} }
  class DropdownComponent { constructor(el){this.selectEl=el?el.createEl('select'):document.createElement('select');this._v='';} addOption(v,d){const o=this.selectEl.createEl('option',{value:v,text:d});o.value=v;return this;} addOptions(ops){Object.entries(ops).forEach(([v,d])=>this.addOption(v,d));return this;} getValue(){return this.selectEl.value;} setValue(v){this.selectEl.value=v;return this;} onChange(cb){this.selectEl.addEventListener('change',()=>cb(this.selectEl.value));return this;} setDisabled(d){this.selectEl.disabled=!!d;return this;} }
  class ButtonComponent { constructor(el){this.buttonEl=el?el.createEl('button'):document.createElement('button');} setButtonText(t){this.buttonEl.textContent=t;return this;} setCta(){return this;} setWarning(){return this;} setDisabled(d){this.buttonEl.disabled=!!d;return this;} onClick(cb){this.buttonEl.addEventListener('click',cb);return this;} setIcon(i){this.buttonEl.setAttribute('data-icon',i);return this;} setTooltip(t){this.buttonEl.title=t;return this;} }
  class ExtraButtonComponent { constructor(el){this.extraSettingsEl=el?el.createEl('button'):document.createElement('button');} setIcon(i){this.extraSettingsEl.setAttribute('data-icon',i);return this;} setTooltip(t){this.extraSettingsEl.title=t;return this;} onClick(cb){this.extraSettingsEl.addEventListener('click',cb);return this;} setDisabled(d){this.extraSettingsEl.disabled=!!d;return this;} }

  return {
    // Core
    Plugin, ItemView, Component, Modal, Setting, PluginSettingTab,
    SuggestModal, FuzzySuggestModal,
    // File types
    TAbstractFile, TFile, TFolder,
    // UI
    Notice, Menu, Scope, Keymap, Platform,
    // Components
    AbstractTextComponent, TextComponent, TextAreaComponent,
    ToggleComponent, SliderComponent, DropdownComponent,
    ButtonComponent, ExtraButtonComponent,
    // Rendering
    MarkdownRenderer, setIcon, setTooltip,
    // Utils
    normalizePath, debounce, moment, htmlToMarkdown,
    sanitizeHTMLToDom, prepareFuzzySearch, prepareSimpleSearch,
    sortSearchResults, renderMatches,
    addIcon, getIcon, requireApiVersion, requestUrl,
    parseFrontMatterTags, getAllTags, parseLinktext, getLinkpath,
    stringifyYaml, parseYaml,
    // Noop stubs for anything else the plugin might import
    loadPdfJs:   () => Promise.reject(new Error('no pdf')),
    loadMermaid: () => Promise.reject(new Error('no mermaid')),
    Vault: class Vault {}, App: class App {},
    Workspace: class Workspace {}, WorkspaceLeaf: class WorkspaceLeaf {},
    MetadataCache: class MetadataCache {},
    FileManager:  class FileManager {},
    Editor:       class Editor {},
    MarkdownView: class MarkdownView {},
    EventRef:     class EventRef {},
    editorViewField: null, editorEditorField: null, editorInfoField: null,
  };
})();
