# Technology Stack

**Analysis Date:** 2026-03-28

## Languages

**Primary:**
- C++ 17 - Qt/WebEngine native application layer (`src/*.cpp`, `src/*.h`)
- JavaScript (ES6+) - Web UI bootstrap and QWebChannel integration (`resources/chat/index.html`)
- HTML5 - Main UI template (`resources/chat/index.html`)
- CSS3 - Styling (`resources/chat/claudian.css`, `resources/claudian/styles.css`)

**Secondary:**
- YAML - CI/CD workflow configuration (`.github/workflows/*.yml`)

## Runtime

**Environment:**
- C++ compiled executable (macOS binary)
- Qt6 WebEngine (Chromium-based) - JavaScript/HTML runtime

**Supported Platform:**
- macOS 12 Monterey or later
- ARM64 architecture (optimized in CI/CD with `arm64.dmg` artifact)

## Frameworks & Libraries

**Core Framework:**
- Qt 6.8+ - Desktop GUI framework
  - `Qt6::Core` - Event loop, signals/slots
  - `Qt6::Gui` - Window management
  - `Qt6::Widgets` - Native macOS widgets
  - `Qt6::WebEngineWidgets` - Chromium WebEngine renderer
  - `Qt6::WebChannel` - Qt/JS bidirectional communication

**Web/Frontend:**
- Claudian plugin bundle (CommonJS via esbuild) - Chat UI loaded from `resources/claudian/main.js`
- Obsidian API mock (`obsidian-shim.js`) - Minimal compatibility layer for running Claudian outside Obsidian
- QWebChannel JavaScript API (built into Qt) - Bridges Qt signals/slots to JavaScript

**Design System:**
- Claudian design system CSS - Dark mode theme via CSS variables (`resources/claudian/styles.css`)
- Obsidian CSS variable defaults - Fallback for `--background-primary`, `--text-normal`, etc.

## Key Dependencies

**Native C++ Runtime:**
- Qt 6.8.x (modular Homebrew formulae: `qtbase`, `qtwebengine`, `qtdeclarative`)
- macOS system frameworks (Cocoa for native window management)

**JavaScript Runtime (Embedded):**
- QWebChannel transport (bundled with Qt6::WebChannel)
- Claudian plugin CommonJS bundle (bundled as `resources/claudian/main.js`)
- Minimal polyfills in `obsidian-shim.js` for Node.js/Electron APIs

**External Tool (Required):**
- Claude Code CLI - `@anthropic-ai/claude-code` (installed globally via npm)
  - Must be available as `claude` executable in PATH
  - Invoked as subprocess: `claude --output-format stream-json --print <prompt> [--resume <session_id>] [--model <model>] [--dangerously-skip-permissions]`

## Configuration

**Build System:**
- CMake 3.16+ - Project configuration
  - `CMakeLists.txt` - Build rules, Qt component discovery, macOS bundle setup

**Runtime Configuration:**
- Environment variables (Qt/WebEngine):
  - `QT_PLUGIN_PATH` - Location of Qt platform plugins (required for standalone binary)
  - `QTWEBENGINE_REMOTE_DEBUGGING` - Optional; enable Chrome DevTools at port 9222
- Working directory - Set at runtime via C++ `QProcess::setWorkingDirectory()`

**macOS App Bundle:**
- `qt.conf` - Configures plugin directory for sandboxed app bundle
- Cocoa integration plugin bundled at `Contents/PlugIns/platforms/libqcocoa.dylib`

## Build Configuration

**Build Rules:**
- C++ standard: C++17 (`CMAKE_CXX_STANDARD`)
- Meta-object compilation: Automatic (`CMAKE_AUTOMOC ON`)
- Resource compilation: Automatic (`CMAKE_AUTORCC ON`)
- Output: Native macOS executable with app bundle structure

**Resource Bundling:**
- `resources.qrc` - Qt resource file that embeds:
  - `/chat/index.html` - Main UI template
  - `/chat/claudian.css` - Chat interface styles
  - `/chat/obsidian-shim.js` - Obsidian API compatibility layer
  - `/claudian/main.js` - Claudian plugin bundle (esbuild CommonJS)
  - `/claudian/styles.css` - Claudian design system styles

**Output Artifacts:**
- macOS app bundle: `build/ClaudianQt.app` (from CMake on GitHub Actions)
- Disk image: `ClaudianQt-<version>-arm64.dmg` (release automation)

## Platform Requirements

**Development:**
- macOS 12+ with Xcode Command Line Tools
- Homebrew with modular Qt6 formulae (`qtbase`, `qtwebengine`, `qtdeclarative`)
- CMake 3.16+
- Node.js + `npm install -g @anthropic-ai/claude-code`

**Production:**
- macOS 12+ (no additional dependencies beyond bundled Qt libraries and system frameworks)
- Claude Code CLI must be installed: `npm install -g @anthropic-ai/claude-code`

## CI/CD Stack

**Hosting & Release:**
- GitHub Actions (`.github/workflows/`)
- GitHub Releases API (for publishing DMG artifacts)

**Build Environment:**
- macOS runner (`runs-on: macos-latest`)
- GitHub Actions Qt installation: `jurplel/install-qt-action@v4` (v6.8.*)

**Release Process:**
- macdeployqt (Qt tool) - Bundles dependencies into app
- hdiutil - Creates distributable disk image (DMG)

---

*Stack analysis: 2026-03-28*
