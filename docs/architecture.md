# Architecture

## Overview

CA_Dashboard monitors multiple Claude Code sessions running in parallel on the local machine. It surfaces per-session state in a terminal UI so users can tell at a glance which sessions are executing, waiting for input, idle, or hanging.

Claude Code exposes no API for session status. All monitoring is file-based and process-based, reading data that Claude Code already writes to disk.

---

## Data Source

Each running Claude Code session writes a JSON file to `~/.claude/sessions/<pid>.json`:

```json
{
  "pid": 47779,
  "sessionId": "21de92ae-1da4-4cdd-9ff1-d3fb56d4a6c7",
  "cwd": "/Users/syu/workspace/CA_Dashboard",
  "startedAt": 1777963944851,
  "updatedAt": 1777969533142,
  "status": "busy",
  "version": "2.1.128",
  "kind": "interactive",
  "entrypoint": "cli"
}
```

Key fields used by the dashboard:

| Field | Use |
|---|---|
| `pid` | Cross-check with OS process list to confirm liveness |
| `sessionId` | Stable identifier for tracking across file changes |
| `cwd` | Display project name in the UI |
| `status` | Primary status signal (`"busy"` observed; other values TBD) |
| `updatedAt` | Staleness detection — a stale timestamp with a live PID indicates hanging |

---

## Status Resolution

Status is derived from combining the session file with OS process inspection:

| Signals | Derived Status |
|---|---|
| `status: "busy"` + recent `updatedAt` + active child processes | **Executing** |
| `status: "busy"` + recent `updatedAt` + no active child processes | **Waiting** (for user input) |
| `status` not `"busy"` + recent `updatedAt` | **Idle** |
| PID alive + `updatedAt` not updated beyond threshold (default: 2 min) | **Hanging** |
| PID not in OS process list | Session ended — omitted from watch view |

Process signals:
- **Liveness**: `ps -p <pid>` — confirms the Claude Code process is still running
- **Child activity**: `pgrep -P <pid>` — active children indicate the agent is executing a tool

---

## Component Architecture

```
src/
├── types.ts                   # SessionInfo, SessionStatus, WatchedSession
├── watcher/
│   └── sessionFileWatcher.ts  # fs.watch on ~/.claude/sessions/ → emits SessionInfo[]
├── resolver/
│   └── statusResolver.ts      # SessionInfo + process checks → SessionStatus
└── ui/
    └── dashboard.tsx          # Ink TUI — watch mode and select mode
```

### Data Flow

```
~/.claude/sessions/*.json
          │
          ▼
 SessionFileWatcher          (fs.watch + periodic read)
          │
          ▼
   StatusResolver            (ps -p, pgrep -P)
          │
          ▼
   Dashboard (Ink TUI)       (re-renders on state change)
```

---

## UI

Built with **Ink** (React renderer for the terminal). No browser required.

The TUI has two interactive modes:

### Watch mode (default)

Displays only the sessions the user has selected to watch.

```
┌──────────┬───────────┬────────────┬─────────────┐
│ Session  │ Project   │ Status     │ Last Active │
├──────────┼───────────┼────────────┼─────────────┤
│ session1 │ CA_Dash   │ ⚙ Executing│ just now    │
│ session2 │ InboxOwl  │ ⏳ Waiting │ 12s ago     │
└──────────┴───────────┴────────────┴─────────────┘
[s] select sessions   [q] quit
```

### Select mode

Lists all discovered sessions. The user toggles which ones to watch with `space`, then confirms with `enter`.

```
Select sessions to watch:
  [✓] session1  CA_Dashboard   (active)
  [✓] session2  InboxOwl       (active)
  [ ] session3  api-svc        (ended)

↑↓ navigate   space toggle   enter confirm
```

### UI state

| State | Type | Description |
|---|---|---|
| `allSessions` | `SessionInfo[]` | All sessions discovered by the watcher |
| `watchedIds` | `Set<string>` | Session IDs selected by the user |
| `mode` | `'watch' \| 'select'` | Current UI mode |

---

## Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (ESM) |
| Terminal UI | Ink + React |
| Test runner | Vitest |
| Linter | ESLint + @typescript-eslint |
| Process inspection | `child_process.execSync` (no extra deps) |
