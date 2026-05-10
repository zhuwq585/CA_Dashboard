# Architecture

## Overview

CA_Dashboard monitors multiple Claude Code sessions running in parallel on the local machine. It surfaces per-session state in a terminal UI so users can tell at a glance which sessions are executing, waiting for input, idle, or hanging.

Claude Code exposes no API for session status. All monitoring is file-based and process-based, reading data that Claude Code already writes to disk.

---

## Data Sources

CA_Dashboard reads two file-based data sources that Claude Code maintains:

1. **Session metadata** — `~/.claude/sessions/<pid>.json`
2. **Conversation log** — `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`

The session JSON provides identity and metadata (pid, cwd, name). The JSONL conversation log provides the activity signal that distinguishes Executing / Waiting / Idle.

### Session metadata: `~/.claude/sessions/<pid>.json`

Each running Claude Code session writes a JSON file to `~/.claude/sessions/<pid>.json`. Two schema versions exist:

**Full schema (Claude Code v2.1+):**
```json
{
  "pid": 47779,
  "sessionId": "21de92ae-1da4-4cdd-9ff1-d3fb56d4a6c7",
  "name": "ca-dashboard-architecture",
  "cwd": "/Users/syu/workspace/CA_Dashboard",
  "startedAt": 1777963944851,
  "procStart": "Tue May  5 06:52:24 2026",
  "version": "2.1.128",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "cli",
  "status": "busy",
  "updatedAt": 1778049097604
}
```

**Old schema (pre-name/status era):** only `pid`, `sessionId`, `cwd`, `startedAt`, `kind`, `entrypoint` — no `status`, no `updatedAt`, no `name`.

Key fields:

| Field | Use |
|---|---|
| `pid` | Cross-check with OS process list to confirm liveness |
| `sessionId` | Stable identifier; also locates the JSONL conversation log |
| `startedAt` | Secondary key for detecting PID recycling |
| `name` | Primary display name (human-readable, set by Claude Code) |
| `cwd` | Locates the JSONL conversation log; fallback display name (`path.basename(cwd)`) |
| `updatedAt` | One of two inputs to the Hanging staleness check |

The `status` field is **not** consulted. It is only ever observed as `"busy"` while alive and stops updating during approval prompts, so it cannot distinguish Executing / Waiting / Idle reliably.

### Conversation log: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`

Claude Code appends every assistant turn, user turn, and tool call to a JSONL conversation log. The **last entry** of this file is the definitive activity signal.

**Path encoding**: every `/` in the absolute `cwd` is replaced with `-`. No hashing.

| `cwd` | encoded subdir |
|---|---|
| `/Users/syu/workspace/CA_Dashboard` | `-Users-syu-workspace-CA_Dashboard` |

**Schema (fields used):**

```jsonc
{
  "type": "assistant" | "user" | "system" | "summary",
  "timestamp": "2026-05-08T03:16:53.778Z",
  "uuid": "...",
  "message": {                 // present on assistant entries
    "role": "assistant",
    "content": [ { "type": "tool_use" | "text" | "thinking", ... } ],
    "stop_reason": "tool_use" | "end_turn" | "stop_sequence" | "max_tokens"
  }
}
```

**Conversation state**, derived from the last entry of the JSONL:

| Last entry | `ConversationState.kind` | Meaning |
|---|---|---|
| `assistant` + `stop_reason: "tool_use"` + `tool_use` content block (no following `user`) | `pendingToolApproval` | Tool requested; awaiting approval or active execution |
| `assistant` with terminal `stop_reason` (e.g. `end_turn`) | `assistantDone` | Conversation paused, awaiting user's next message |
| `user` (no following `assistant`) | `userTurn` | Model is generating a response |
| File missing / empty / unparseable | `unknown` | Fall back to Idle |

The reader tails the last 64 KB of the file, drops a trailing partial line, and parses entries in reverse to find the last well-formed signal.

---

## Status Resolution

A single constant governs staleness: `HANGING_THRESHOLD_MS = 7_200_000` (120 minutes).

Decision tree (first match wins):

```
1. ps -p <pid> fails                                                  →  Dead

2. ALL defined activity signals (session.updatedAt and JSONL mtime) older
   than HANGING_THRESHOLD_MS                                          →  Hanging
   (skipped when neither timestamp is defined)

3. ConversationState = pendingToolApproval
   3a. real children exist (filtered)                                  →  Executing
   3b. no real children                                                →  Waiting

4. ConversationState = userTurn (model generating)                    →  Executing

5. ConversationState = assistantDone                                  →  Waiting

6. ConversationState = unknown (no JSONL)                             →  Idle
```

"Real children" = PIDs returned by `pgrep -P <pid>` whose command name is **not** in `HELPER_PROCESSES = ['caffeinate']`. Claude Code maintains a persistent `caffeinate` child to prevent system sleep; it must be filtered out or it produces false Executing signals.

### Display Name

Resolved in priority order: `name` field → `path.basename(cwd)` → first 8 chars of `sessionId`.

---

## Component Architecture

```
src/
├── types.ts                       # SessionInfo, SessionStatus, ResolvedSession, ConversationState
├── watcher/
│   └── sessionFileWatcher.ts      # fs.watch + 100ms debounce → emits SessionInfo[]
├── jsonl/
│   └── conversationLogReader.ts   # tails JSONL, classifies last entry → ConversationState
├── resolver/
│   └── statusResolver.ts          # decision tree → ResolvedSession[]
└── ui/
    └── dashboard.tsx              # Ink TUI — watch mode and select mode
```

### Data Flow

```
~/.claude/sessions/*.json
          │
    ┌─────┴───────────────────┐
    │ fs.watch (file events)  │
    │ + 1s periodic tick      │
    └─────┬───────────────────┘
          │
          ▼
 SessionFileWatcher ──▶ StatusResolver ──▶ Dashboard (Ink TUI)
                              │
                              ├── tinyexec (async): ps -p, pgrep -P
                              │
                              └── ConversationLogReader (async):
                                    ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
```

Two triggers feed the resolver:
- **File events** (`fs.watch`): session JSON changed → debounce 100ms → re-read → re-resolve
- **1s periodic tick**: liveness and child processes can change without file writes → re-resolve using cached session data

### Operational Edge Cases

| Case | Handling |
|---|---|
| JSON parse failure (mid-write race) | try-catch; retain previous valid value; retry on next event |
| Dead PID with lingering session file | Resolved as Dead; file left on disk (dashboard never deletes) |
| Old schema (no `updatedAt`) | Hanging check skipped if both `updatedAt` and JSONL `mtimeMs` are undefined |
| Long-running tool (fresh `updatedAt`, stale JSONL `mtime`) | NOT Hanging — at least one signal is fresh |
| Approval prompt (stale `updatedAt`, fresh JSONL `mtime`) | NOT Hanging — at least one signal is fresh |
| PID recycled by OS | `startedAt` used as secondary key alongside `pid` to detect collision |
| JSONL file missing | `ConversationState = unknown` → resolved as Idle |
| JSONL trailing partial line (mid-write race) | Reader drops the partial trailing line and parses the previous well-formed entry |
| JSONL very large | Reader tails only the last 64 KB; sessions with very long context are still classified correctly because only the last entry matters |

---

## UI

Built with **Ink** (React renderer for the terminal). No browser required.

### Watch mode (default)

Displays only sessions the user has selected to watch.

```
┌──────────────────────┬────────────┬─────────────┐
│ Name                 │ Status     │ Last Active │
├──────────────────────┼────────────┼─────────────┤
│ ca-dashboard-arch    │ ⚙ Executing│ just now    │
│ InboxOwl             │ ⏳ Waiting │ 12s ago     │
└──────────────────────┴────────────┴─────────────┘
[s] select sessions   [q] quit
```

### Select mode

Lists all discovered sessions. `space` toggles, `enter` confirms, `esc` cancels.

```
Select sessions to watch:
  [✓] ca-dashboard-arch   CA_Dashboard   (executing)
  [✓] InboxOwl            InboxOwl       (waiting)
  [ ] old-session         api-svc        (idle)

↑↓ navigate   space toggle   enter confirm   esc cancel
```

### UI State

| Field | Type | Description |
|---|---|---|
| `allSessions` | `ResolvedSession[]` | All discovered sessions with resolved status |
| `watchedIds` | `Set<string>` | `sessionId`s the user has selected — in-memory only, resets on launch |
| `mode` | `'watch' \| 'select'` | Current UI mode |

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (ESM) | |
| Terminal UI | Ink + React | To be installed |
| Process inspection | `tinyexec` | Already installed; async, non-blocking (~5–20ms/call) |
| File watching | Node.js `fs.watch` | macOS FSEvents fires post-write; debounce 100ms |
| Test runner | Vitest | Already installed |
| Linter | ESLint + @typescript-eslint | Already installed |
