# Architecture

## Overview

CA_Dashboard monitors multiple Claude Code sessions running in parallel on the local machine. It surfaces per-session state in a terminal UI so users can tell at a glance which sessions are executing, waiting for input, idle, or hanging.

Claude Code exposes no API for session status. All monitoring is file-based and process-based, reading data that Claude Code already writes to disk.

---

## Data Source

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
| `sessionId` | Stable identifier for tracking across file changes |
| `startedAt` | Secondary key for detecting PID recycling |
| `name` | Primary display name (human-readable, set by Claude Code) |
| `cwd` | Fallback display name (`path.basename(cwd)`) |
| `status` | Activity signal — only ever observed as `"busy"` while alive |
| `updatedAt` | Staleness detection for Hanging state |

**Important:** `status` has only been observed as `"busy"` while a process is alive. There are no observed transitions to "idle" or "waiting". Executing vs. Waiting must be inferred from child process inspection, not from `status`.

---

## Status Resolution

A single constant governs staleness: `HANGING_THRESHOLD_MS = 120_000` (2 minutes).

Decision tree (first match wins):

```
1. ps -p <pid> fails               →  Dead      (omit from all views)
2. status field missing             →  Idle      (old schema, insufficient data)
3. status !== "busy"                →  Idle      (session ended normally)
4. updatedAt age > THRESHOLD        →  Hanging   (alive but not updating)
5. real child processes exist*      →  Executing
6. (default)                        →  Waiting   (busy, recent, no tool children)
```

\* "Real children" = PIDs returned by `pgrep -P <pid>` whose command name is **not** in `HELPER_PROCESSES = ['caffeinate']`. Claude Code always maintains a `caffeinate` child to prevent system sleep; this must be filtered out or it produces false Executing signals.

### Display Name

Resolved in priority order: `name` field → `path.basename(cwd)` → first 8 chars of `sessionId`.

---

## Component Architecture

```
src/
├── types.ts                   # SessionInfo, SessionStatus, ResolvedSession
├── watcher/
│   └── sessionFileWatcher.ts  # fs.watch + 100ms debounce → emits SessionInfo[]
├── resolver/
│   └── statusResolver.ts      # decision tree → ResolvedSession[]
└── ui/
    └── dashboard.tsx          # Ink TUI — watch mode and select mode
```

### Data Flow

```
~/.claude/sessions/*.json
          │
    ┌─────┴───────────────────┐
    │ fs.watch (file events)  │
    │ + 1s periodic tick      │  ← process state can change without file update
    └─────┬───────────────────┘
          │
          ▼
 SessionFileWatcher ──▶ StatusResolver ──▶ Dashboard (Ink TUI)
                              │
                         tinyexec (async):
                           ps -p <pid>
                           pgrep -P <pid>
```

Two triggers feed the resolver:
- **File events** (`fs.watch`): session JSON changed → debounce 100ms → re-read → re-resolve
- **1s periodic tick**: liveness and child processes can change without file writes → re-resolve using cached session data

### Operational Edge Cases

| Case | Handling |
|---|---|
| JSON parse failure (mid-write race) | try-catch; retain previous valid value; retry on next event |
| Dead PID with lingering session file | Resolved as Dead; file left on disk (dashboard never deletes) |
| Old schema (no `status`/`updatedAt`) | Resolved as Idle; display name via `path.basename(cwd)` |
| PID recycled by OS | `startedAt` used as secondary key alongside `pid` to detect collision |

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
