# Codebase Structure

**Analysis Date:** 2026-03-28

## Directory Layout

```
claudian-qt/
├── src/                        # C++ source files
│   ├── main.cpp               # Application entry point
│   ├── mainwindow.h           # Main window declaration
│   ├── mainwindow.cpp         # Main window implementation
│   ├── claudebridge.h         # Qt/JS bridge declaration
│   ├── claudebridge.cpp       # Qt/JS bridge implementation
│   ├── claudeprocess.h        # Subprocess manager declaration
│   └── claudeprocess.cpp      # Subprocess manager implementation
├── resources/                  # Static assets and resource definitions
│   ├── resources.qrc          # Qt resource bundle manifest
│   ├── chat/                  # Web UI files
│   │   ├── index.html         # Main HTML (chat UI + bootstrap)
│   │   ├── claudian.css       # Chat-specific styles (copied from claudian/)
│   │   └── obsidian-shim.js   # Obsidian API stub for plugin compatibility
│   └── claudian/              # Claudian design system (third-party)
│       ├── main.js            # Claudian plugin bundle
│       ├── styles.css         # Design system styles
│       ├── manifest.json      # Plugin metadata
│       └── data.json          # Plugin config
├── CMakeLists.txt             # Build configuration
├── CLAUDE.md                  # Project documentation for Claude
└── build/                     # CMake build artifacts (generated)
```

## Directory Purposes

**src/:**
- Purpose: C++ source code for application logic
- Contains: Classes, functions, Qt signal/slot definitions
- Key files:
  - `main.cpp`: Creates QApplication, shows MainWindow, runs event loop
  - `mainwindow.cpp`: Creates QWebEngineView, QWebChannel, loads bundled HTML
  - `claudebridge.cpp`: Implements Q_OBJECT bridge for JavaScript communication
  - `claudeprocess.cpp`: Manages subprocess lifecycle and JSON parsing

**resources/:**
- Purpose: Static assets bundled into the application binary
- Contains: HTML, CSS, JavaScript, design system files
- Key files:
  - `resources.qrc`: Manifest defining which files are bundled and their URL prefix (`/chat`, `/claudian`)
  - `chat/index.html`: Complete web UI (HTML + inline CSS + inline JavaScript)
  - `chat/claudian.css`: Chat-specific CSS overrides and layout rules
  - `claudian/main.js`: Third-party Claudian plugin (UI framework)

**resources/chat/:**
- Purpose: Web UI files served to WebEngine
- Contains: HTML markup, chat-specific styles, browser compatibility shims
- Key files:
  - `index.html`: Single-page app loaded by MainWindow; defines page structure, CSS variables (Obsidian color palette), QtBridgeService, bootstrap IIFE
  - `claudian.css`: Desktop-specific CSS: message wrapping, copy button visibility, input area padding, history panel layout
  - `obsidian-shim.js`: Mock Obsidian API classes (`TFile`, `TFolder`) required by Claudian plugin

**resources/claudian/:**
- Purpose: Third-party Claudian design system — chat UI component framework
- Contains: Plugin code, styles, and configuration
- Key files:
  - `main.js`: Claudian plugin constructor and UI controllers (inputController, streamController, messageRenderer)
  - `styles.css`: Core design system CSS (colors, typography, spacing, components)
  - `manifest.json`: Plugin metadata (id, name, version)
  - `data.json`: Plugin configuration

**build/:**
- Purpose: CMake build artifacts
- Generated: Yes (from CMakeLists.txt)
- Committed: No (in .gitignore)
- Contains: Intermediate object files, generated moc files, final executable

## Key File Locations

**Entry Points:**
- `src/main.cpp`: Application startup — creates QApplication, MainWindow, runs event loop
- `src/mainwindow.cpp`: Window initialization — creates WebEngine, QWebChannel, loads `qrc:/chat/index.html`
- `resources/chat/index.html` (lines 358+): Page bootstrap — loads Claudian plugin, instantiates QtBridgeService, mounts UI

**Configuration:**
- `CMakeLists.txt`: Build configuration, Qt component linking, resource bundling, macOS app bundle settings

**Core Logic:**
- `src/claudebridge.h/cpp`: Application state (cwd, model, yolo), public slots (sendMessage, abort, settings), session management
- `src/claudeprocess.h/cpp`: Subprocess spawning, JSON stream parsing, signal emission
- `resources/chat/index.html` (lines 274–339): QtBridgeService — translates C++ signals to async generator for Claudian

**Testing:**
- No test files in codebase — manual testing only

## Naming Conventions

**Files:**
- `.h` files: C++ headers (class declarations)
- `.cpp` files: C++ implementations
- `.qrc` files: Qt resource manifest (XML)
- `.js` files: JavaScript (including CommonJS in Claudian)
- `.css` files: Stylesheets

**Directories:**
- `src/`: Source code
- `resources/`: Static assets
- `build/`: Build artifacts
- `.planning/`: GSD planning documents

**C++ Classes:**
- PascalCase: `ClaudeBridge`, `ClaudeProcess`, `MainWindow`
- All inherit from Qt base classes (`QObject`, `QMainWindow`, etc.)
- Use `Q_OBJECT` macro for signal/slot support

**C++ Members:**
- Private members: `m_` prefix (e.g., `m_proc`, `m_sessionId`, `m_cwd`, `m_buffer`)
- Public properties: camelCase (e.g., `cwd()`, `model()`, `yolo()`)

**Qt Signals/Slots:**
- camelCase: `sendMessage()`, `textReady()`, `toolUseStarted()`, `turnFinished()`
- No return values in signals
- Parameters in signals exactly match what JS receives

**JavaScript:**
- camelCase: `QtBridgeService`, `injectQtServiceIntoTab()`, `mockApp`, `bootstrap()`
- Constant prefixes: `m_` for class members (e.g., `this._bridge`, `this._queue`)

**CSS Classes:**
- kebab-case: `qt-toolbar`, `qt-cwd`, `qt-pick-btn`, `claudian-messages`, `claudian-input-container`
- Prefix `qt-` for app-specific styles, `claudian-` for design system

## Where to Add New Code

**New Feature (e.g., model selection dropdown):**
- Primary code:
  - `src/claudebridge.h/cpp`: Add Q_PROPERTY, setter slot, modelChanged signal (already exists: `model`, `setModel`, `modelChanged`)
  - `resources/chat/index.html`: Add UI controls, JS handlers to call `bridge.setModel()`
- Tests: Manual (run app, verify signal flow)

**New Subprocess Argument:**
- Implementation: `src/claudeprocess.cpp` in `send()` method (lines 20–54), add to `args` QStringList
- Example: Model already implemented as `--model <model>` if `!m_model.isEmpty()`

**New Session History Method:**
- Public slot: `src/claudebridge.h` add slot declaration, `src/claudebridge.cpp` implement
- Example: `requestSessions()` (lines 72–117) and `loadSession()` (lines 119–195)

**New Signal (e.g., to notify JS of progress):**
- Declaration: `src/claudebridge.h` in `signals:` section
- Emission: `src/claudebridge.cpp` when condition met
- JavaScript handler: `resources/chat/index.html` in `QtBridgeService` constructor, connect signal and enqueue chunk

**New CSS Styling:**
- App-specific: `resources/chat/index.html` `<style>` section (lines 9–231)
- Design system overrides: `resources/chat/claudian.css` (if loaded separately; currently bundled into index.html)

**New HTML Element:**
- Location: `resources/chat/index.html` body section (lines 233–262 for toolbar, line 262 for chat root)
- Style: Add to `<style>` section
- JavaScript handler: Add event listener in bootstrap IIFE or QtBridgeService constructor

## Special Directories

**build/:**
- Purpose: CMake-generated artifacts
- Generated: Yes (by `cmake --build .`)
- Committed: No

**build/ClaudianQt_autogen/**
- Purpose: Generated Qt moc (meta-object compiler) files and resource compilation
- Generated: Yes (by Qt6 CMake integration)
- Committed: No

**.planning/**
- Purpose: GSD (Generative Software Development) planning documents
- Generated: Yes (by GSD commands)
- Committed: Yes (documentation)

## Resource Bundling

**How Qt resources work:**
- `resources.qrc` is an XML manifest mapping file paths to URL prefixes
- During build, `CMAKE_AUTORCC` compiles QRC file into C++ code (`qrc_resources.cpp`)
- At runtime, files are accessible via `qrc://<prefix>/<alias>` URLs

**Prefixes and aliases:**
```xml
<qresource prefix="/chat">
  <file alias="index.html">chat/index.html</file>    → qrc:/chat/index.html
  <file alias="claudian.css">chat/claudian.css</file> → qrc:/chat/claudian.css
  <file alias="obsidian-shim.js">...</file>           → qrc:///chat/obsidian-shim.js
</qresource>
<qresource prefix="/claudian">
  <file alias="main.js">claudian/main.js</file>        → qrc:/claudian/main.js
  <file alias="styles.css">claudian/styles.css</file>  → qrc:/claudian/styles.css
</qresource>
```

**Loading in HTML:**
```html
<link rel="stylesheet" href="qrc:///claudian/styles.css">   <!-- Design system -->
<script src="qrc:///qtwebchannel/qwebchannel.js"></script>  <!-- Qt built-in -->
<script src="qrc:///chat/obsidian-shim.js"></script>        <!-- App-specific -->
```

**Bundled but not in QRC:**
- `resources/claudian/data.json` — defined in QRC but not loaded by HTML
- Not currently served to WebEngine (design system styles loaded from styles.css instead)

## Build Output

**Executable:** `build/ClaudianQt`

**macOS App Bundle:** `build/ClaudianQt.app/`
- CMakeLists.txt configures `MACOSX_BUNDLE TRUE`
- Post-build step copies Cocoa plugin and `qt.conf` into bundle
- Allows running without `QT_PLUGIN_PATH` environment variable

---

*Structure analysis: 2026-03-28*
