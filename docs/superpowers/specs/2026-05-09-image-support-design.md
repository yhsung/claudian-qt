# Image Support Design

**Date:** 2026-05-09

**Goal:** Add desktop-style multi-image support to Claudian Qt so users can attach images by picker, drag/drop, or clipboard paste, send them with a prompt in a single turn, and see persistent thumbnail galleries when reopening a session.

## Scope

### In Scope

- Multiple image attachments per user message
- Three attachment entry points:
  - Native file picker
  - Drag and drop onto the composer area
  - Clipboard paste of image data
- Pre-send thumbnail tray with remove actions
- Persistent managed copies of attached images
- Reopened session history showing thumbnail galleries above user message text
- In-app larger preview when clicking a history thumbnail
- Automated tests for protocol, manifest persistence, first-turn finalization, and history reconstruction
- Manual verification for picker, drag/drop, paste, reload, preview, and failure flows

### Out of Scope

- PDFs or arbitrary non-image attachments
- Editing attachments on past turns
- Retroactively adding images to an already-sent message
- Replacing Claude's text history storage with an app-owned full transcript store

## Product Decisions

- Scope level: desktop-like image support
- One message may include multiple images
- Reopened conversations should show thumbnail galleries, not file chips
- Attached images are stored as managed copies, not original-path references
- Architecture approach: sidecar attachment store plus manifest, with Claude session files still serving as the source of truth for conversation text

## UX Design

### Composer Flow

The composer gets a dedicated attachment tray above the text area. Pending image attachments render as thumbnail tiles with filename metadata and an explicit remove action. Users can add more images through a file picker, drag/drop, or clipboard paste without leaving the composer flow.

The tray can grow to multiple images without expanding the textarea unpredictably. When many images are attached, the tray scrolls horizontally or wraps within a bounded area so the text input remains usable for long prompts.

### Send Behavior

A send action submits one user turn containing:

- The prompt text
- Zero or more attached images

After a successful send, the pending attachment tray clears. If sending fails before the turn is committed, the attachments remain in place so the user can retry or remove individual images.

### Reopened History

When reloading a session, any user turn with images renders a thumbnail gallery above the user text. Clicking a thumbnail opens a larger in-app preview. If the app cannot find valid attachment metadata for a turn, it still renders the text portion of the turn rather than failing the whole history view.

## Architecture

The current app remains split across three layers:

- `resources/chat/*` for the embedded web UI
- `src/*` for the Qt bridge exposed through `QWebChannel`
- `bridge/src/*` for the persistent Node daemon and Claude SDK integration

Image support extends that structure rather than replacing it.

### Web UI Responsibilities

`resources/chat/chat.js` owns:

- Pending attachment state
- Local thumbnail generation for selected or pasted images
- Drag/drop handling
- Clipboard paste handling
- Rendering pending attachment tiles
- Rendering history thumbnail galleries
- Opening and closing the larger preview modal
- Sending a structured message payload instead of plain text

`resources/chat/index.html` and `resources/chat/chat.css` expand to include:

- Attachment tray UI
- Add-attachment affordances
- Drop-target styling
- History thumbnail gallery layout
- Preview modal structure and styling

### Qt Bridge Responsibilities

`src/claudebridge.h/.cpp` expands from a text-only interface to a structured message interface plus native helpers. It remains responsible for:

- Forwarding structured send commands to the daemon
- Exposing a native image file picker to the web layer
- Providing any native import helper needed for managed-copy creation
- Returning structured errors for rejected attachments or failed imports

`src/bridgedaemon.h/.cpp` continues to carry JSON commands and events, but the protocol grows to support attachment metadata alongside prompt text.

### Daemon Responsibilities

`bridge/src/protocol.ts` defines the richer command and event shapes.

`bridge/src/daemon.ts` becomes responsible for:

- Accepting send commands with text plus attachment metadata
- Finalizing attachment records against the active `sessionId`
- Translating the structured input into the Claude Agent SDK request format for one user turn containing text and image blocks
- Emitting existing streaming events without regressing the current text/tool flow

`bridge/src/session-history.ts` becomes responsible for reconstructing history from two sources:

- Claude session JSONL files for text transcript content
- App-owned sidecar manifest for attachment galleries

## Storage Design

Claude's session files remain the source of truth for conversation text. The app owns image persistence separately.

### Managed Copies

Every selected, dropped, or pasted image is copied into app-managed storage before send. Managed copies guarantee that reopened history thumbnails still work even if the original file in Downloads, Desktop, or clipboard-backed temp storage no longer exists.

### Sidecar Manifest

The app writes an attachment manifest keyed by `sessionId` and user turn. Each attachment record stores the information needed for reload and display, including:

- Stable managed file path
- Thumbnail or preview source path
- Original filename
- MIME type
- Display order within the turn
- Optional dimensions if available

The manifest is app-owned and only tracks image attachments. It does not duplicate the full conversation transcript.

### First-Turn Finalization

The first send in a new conversation does not yet know the final Claude `sessionId`. To handle that cleanly:

- Attachments are staged under an outgoing temporary area before send
- When `session_ready` arrives, the staged attachment records are finalized under the real session storage location
- Only then are they appended into the session manifest for that turn

This keeps new-session image sends compatible with the existing daemon lifecycle.

## Data Flow

### Attachment Intake

Each new image is normalized into a pending attachment record with:

- A managed local copy path
- Preview/thumbnail information for the composer
- Original filename
- MIME type
- Display order

Invalid or failed imports reject only the affected image. Other pending attachments remain intact.

### Send Path

The send path becomes:

1. User composes text and attaches multiple images
2. Web UI sends a structured payload through `QWebChannel`
3. Qt forwards the structured command to the daemon
4. Daemon converts the payload into a Claude SDK query with one user turn containing text and multiple image blocks
5. Existing streaming text and tool events continue to flow back to the UI
6. Successful turn completion preserves the manifest entry for future reloads

### Reload Path

The reload path becomes:

1. `session-history.ts` reads Claude session text turns from JSONL
2. The same loader reads the sidecar attachment manifest for the requested `sessionId`
3. It merges matching attachment records into the user turns they belong to
4. The web UI renders each reconstructed user turn as gallery plus text

## Error Handling

- If image import fails, reject only that image and show a targeted error
- If send fails before the turn is committed, keep pending attachments in the tray
- If manifest writing fails, preserve the active chat flow and surface an error rather than corrupting the transcript view
- If the manifest is missing or unreadable during reload, render text-only history for the affected turns
- If a managed image file is missing at reload time, render a broken-image placeholder or omit the thumbnail for that item without failing the whole session

## Testing Strategy

### Automated Tests

Add or update Vitest coverage in `bridge/tests/*.test.ts` for:

- Attachment-aware daemon command parsing
- Manifest write/read behavior
- New-session first-turn finalization after `session_ready`
- Session history reconstruction that merges Claude text turns with attachment galleries
- Failure behavior when manifest data is missing or malformed

### Manual Verification

Manually verify:

- Pick multiple images and send
- Drag and drop multiple images and send
- Paste an image from clipboard
- Remove one pending image before send
- Send images on the first turn of a brand-new session
- Reopen a session and confirm thumbnail galleries render above user text
- Click a history thumbnail and confirm the larger preview opens
- Confirm failed sends keep pending attachments available for retry

## Implementation Impact

The expected code surface is concentrated and bounded:

- `resources/chat/index.html`
- `resources/chat/chat.css`
- `resources/chat/chat.js`
- `src/claudebridge.h`
- `src/claudebridge.cpp`
- `src/bridgedaemon.h`
- `src/bridgedaemon.cpp`
- `bridge/src/protocol.ts`
- `bridge/src/daemon.ts`
- `bridge/src/session-history.ts`
- `bridge/tests/*.test.ts`

This is a single feature area with coordinated UI, bridge, and daemon changes, but it does not require a full rewrite of the existing conversation architecture.
