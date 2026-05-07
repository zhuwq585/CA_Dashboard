# Spec: Session Watcher & Types

## Scope

Two source files:
- `src/types.ts` — all shared TypeScript types and enums
- `src/watcher/sessionFileWatcher.ts` — watches `~/.claude/sessions/` and emits `SessionInfo[]`

The status resolver and UI are out of scope for this feature.

Read `docs/architecture.md` before implementing.

---

## types.ts

### SessionStatus

```typescript
export enum SessionStatus {
	Executing = 'executing',
	Waiting   = 'waiting',
	Idle      = 'idle',
	Hanging   = 'hanging',
	Dead      = 'dead',
}
```

### SessionInfo

Raw data parsed directly from a `~/.claude/sessions/<pid>.json` file. All fields present in the full schema (v2.1+); optional fields may be absent in the old schema.

```typescript
export interface SessionInfo {
	pid:           number;
	sessionId:     string;
	cwd:           string;
	startedAt:     number;       // ms epoch
	// v2.1+ only
	name?:         string;
	procStart?:    string;
	version?:      string;
	peerProtocol?: number;
	kind?:         string;
	entrypoint?:   string;
	status?:       string;
	updatedAt?:    number;       // ms epoch
}
```

### ResolvedSession

Produced by the status resolver (future feature); defined here to centralise types.

```typescript
export interface ResolvedSession {
	sessionInfo:  SessionInfo;
	status:       SessionStatus;
	displayName:  string;
	resolvedAt:   number;        // ms epoch — when resolution was computed
}
```

---

## sessionFileWatcher.ts

### Public API

```typescript
export interface SessionFileWatcherOptions {
	sessionsDir?:    string;  // default: path.join(os.homedir(), '.claude', 'sessions')
	debounceMs?:     number;  // default: 100
	tickIntervalMs?: number;  // default: 1000
}

export type SessionsChangedCallback = (sessions: SessionInfo[]) => void;

export class SessionFileWatcher {
	constructor(options?: SessionFileWatcherOptions);
	start(onChanged: SessionsChangedCallback): void;
	stop(): void;
}
```

### Behaviour

**`start(onChanged)`**
1. Reads all `*.json` files in `sessionsDir` immediately; parses each to `SessionInfo`; calls `onChanged` with the full list.
2. Opens an `fs.watch` watcher on `sessionsDir` for file create/change/delete events.
3. On any watch event: debounces `debounceMs` ms, then re-scans the full directory and calls `onChanged`.
4. Starts a `tickIntervalMs` periodic timer that re-scans and calls `onChanged` even when no file events occurred — process liveness can change without a file write.

**`stop()`**
- Cancels the `fs.watch` watcher.
- Clears the periodic timer.
- Cancels any pending debounce.
- `onChanged` is **never** called after `stop()` returns.

**JSON parse safety**
- Each file is parsed inside a `try-catch`.
- If parsing fails, the previous valid `SessionInfo` for that file is retained (keyed by filename).
- A failed parse on first encounter is skipped silently (no previous value to retain).

**File filtering**
- Only files whose name ends in `.json` are processed.
- Non-JSON files and subdirectories are ignored.

---

## Test Design

### Test files

| Source file | Test file |
|---|---|
| `src/types.ts` | `src/types.test.ts` |
| `src/watcher/sessionFileWatcher.ts` | `src/watcher/sessionFileWatcher.test.ts` |

### Test environment

- **Runner**: Vitest with `vi.useFakeTimers()` for debounce and tick control
- **File system**: real temp directory via `fs/promises` + `os.tmpdir()` — no mocked fs (integration-style)
- **Cleanup**: `beforeEach` creates a fresh temp dir; `afterEach` removes it and calls `watcher.stop()`

### Fixtures

```typescript
const minimalSession: SessionInfo = {
	pid: 1234,
	sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
	cwd: '/home/user/project',
	startedAt: 1000000000000,
};

const fullSession: SessionInfo = {
	...minimalSession,
	name: 'my-project',
	procStart: 'Mon Jan  1 00:00:00 2026',
	version: '2.1.128',
	peerProtocol: 1,
	kind: 'interactive',
	entrypoint: 'cli',
	status: 'busy',
	updatedAt: 1000000060000,
};
```

### types.ts tests (`src/types.test.ts`)

| ID | Description | Assertion |
|---|---|---|
| T1 | `SessionStatus.Executing` has value `'executing'` | `expect(SessionStatus.Executing).toBe('executing')` |
| T2 | `SessionStatus.Waiting` has value `'waiting'` | `expect(SessionStatus.Waiting).toBe('waiting')` |
| T3 | `SessionStatus.Idle` has value `'idle'` | `expect(SessionStatus.Idle).toBe('idle')` |
| T4 | `SessionStatus.Hanging` has value `'hanging'` | `expect(SessionStatus.Hanging).toBe('hanging')` |
| T5 | `SessionStatus.Dead` has value `'dead'` | `expect(SessionStatus.Dead).toBe('dead')` |

(TypeScript compile-time validation that `minimalSession` and `fullSession` satisfy `SessionInfo` is implicit — if the types are wrong the test file won't compile.)

### sessionFileWatcher.ts tests (`src/watcher/sessionFileWatcher.test.ts`)

| ID | Description | Setup | Assertion |
|---|---|---|---|
| W1 | Initial scan emits existing files | 2 valid JSON files in dir | `onChanged` called once with 2 `SessionInfo` items |
| W2 | Empty directory emits empty array | No files in dir | `onChanged` called once with `[]` |
| W3 | New file triggers update | Start; write new JSON file; advance timers `debounceMs` | `onChanged` called again; new session included |
| W4 | File change triggers update | Start; overwrite file with new pid; advance timers | `onChanged` called with updated `SessionInfo` |
| W5 | File deletion triggers update | Start with 2 files; delete one; advance timers | `onChanged` called with 1 item |
| W6 | Debounce coalesces rapid events | Write 5 files in succession without advancing timers; then advance once | `onChanged` called exactly twice total (initial + one debounced) |
| W7 | Periodic tick fires without file events | Start; advance timers `tickIntervalMs` | `onChanged` called a second time with no file change |
| W8 | JSON parse error retains previous value | Start with valid file; overwrite with invalid JSON; advance timers | `onChanged` called with last valid `SessionInfo` for that file |
| W9 | First-encounter parse error skipped silently | Dir contains only an invalid JSON file | `onChanged` called with `[]`; no exception thrown |
| W10 | Non-JSON files are ignored | Dir has `notes.txt` and `valid.json` | `onChanged` called with only the `.json` entry |
| W11 | `stop()` prevents further callbacks | Start; call `stop()`; advance timers past tick interval | `onChanged` not called after `stop()` |
| W12 | Old schema parsed correctly | JSON with only required fields | `SessionInfo` has `pid`, `sessionId`, `cwd`, `startedAt`; optional fields are `undefined` |
| W13 | Full schema parsed correctly | JSON with all fields | All fields on `SessionInfo` match the written values |
