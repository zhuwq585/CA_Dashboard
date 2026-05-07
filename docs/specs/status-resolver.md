# Spec: Status Resolver

## Scope

One source file:
- `src/resolver/statusResolver.ts` — takes `SessionInfo[]` from the watcher, runs OS process checks, and returns `ResolvedSession[]`

Read `docs/architecture.md` and `docs/specs/session-watcher-types.md` before implementing.

## APIs reused from previous feature

The following types are defined in `src/types.ts` (feature `session-watcher-types`). Import from there — do not redefine them.

```typescript
import { SessionInfo, SessionStatus, ResolvedSession } from '../types.js';
```

| Type | Defined in |
|---|---|
| `SessionInfo` | `src/types.ts` |
| `SessionStatus` | `src/types.ts` |
| `ResolvedSession` | `src/types.ts` |

---

## statusResolver.ts

### Constants

```typescript
const HANGING_THRESHOLD_MS = 120_000;          // 2 minutes
const HELPER_PROCESSES     = ['caffeinate'];   // always-present Claude Code children to ignore
```

Both should be overridable via options (see below).

### Public API

```typescript
export interface StatusResolverOptions {
	hangingThresholdMs?: number;   // default: 120_000
	helperProcesses?:    string[]; // default: ['caffeinate']
}

export class StatusResolver {
	constructor(options?: StatusResolverOptions);
	resolve(sessions: SessionInfo[]): Promise<ResolvedSession[]>;
}
```

### `resolve(sessions)` Behaviour

Processes all sessions **concurrently** (`Promise.all`). For each `SessionInfo`, applies the decision tree below and returns a `ResolvedSession`. Sessions resolved as `Dead` are **included** in the result — the UI layer decides whether to display them.

### Decision Tree

Evaluated in order; first match wins.

```
Step 1  isPidAlive(pid) returns false
           → status: Dead
           → displayName: resolveDisplayName(session)
           → resolvedAt: Date.now()

Step 2  session.status is undefined (old schema)
           → status: Idle

Step 3  session.status !== 'busy'
           → status: Idle

Step 4  (Date.now() - session.updatedAt) > hangingThresholdMs
           → status: Hanging

Step 5  getRealChildPids(pid, helperProcesses) returns non-empty array
           → status: Executing

Step 6  (default)
           → status: Waiting
```

Steps 2–6 only reached when the PID is alive. Steps 4–6 only reached when `status === 'busy'` and `updatedAt` is defined.

### Display Name Resolution

```
name field present      → use name
path.basename(cwd) non-empty  → use basename
(fallback)              → first 8 characters of sessionId
```

Extracted into a pure helper function `resolveDisplayName(session: SessionInfo): string` — this makes it independently testable.

### Process Inspection Helpers

Two private async functions wrap `tinyexec`. They are the only places that call `tinyexec` in this module, making them the sole mock target in tests.

```typescript
async function isPidAlive(pid: number): Promise<boolean>
// Runs: ps -p <pid>
// Returns true if exit code 0, false otherwise.

async function getChildCommands(pid: number): Promise<string[]>
// Runs: pgrep -P <pid> -a  (or two calls: pgrep -P to get pids, ps to get comm names)
// Returns the command names of all child processes.
// Returns [] if pgrep exits non-zero (no children).
```

`getRealChildPids` is not needed externally — the filtering of helper processes happens inside `resolve()` using `getChildCommands`.

---

## Test Design

### Test file

`src/resolver/statusResolver.test.ts`

### Test environment

- **Runner**: Vitest
- **Mocking**: `vi.mock('tinyexec')` — controls `isPidAlive` and `getChildCommands` indirectly by controlling what `tinyexec` returns for each command pattern
- **Time**: `vi.setSystemTime()` to control `Date.now()` for staleness checks (no fake timers needed — `resolve()` is one-shot async, not timer-based)

### Mock pattern

```typescript
import { vi } from 'vitest';
import { x } from 'tinyexec';

vi.mock('tinyexec');
const mockX = vi.mocked(x);

// Helper to configure mock responses per command
function mockPs(pid: number, alive: boolean) {
	mockX.mockImplementation(async (cmd, args) => {
		if (cmd === 'ps' && args?.includes(String(pid))) {
			if (!alive) throw Object.assign(new Error('ps failed'), { exitCode: 1 });
			return { stdout: '', stderr: '', exitCode: 0 } as any;
		}
	});
}
```

### Fixtures (reuse from session-watcher-types spec)

```typescript
const baseSession: SessionInfo = {
	pid: 1234,
	sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
	cwd: '/home/user/my-project',
	startedAt: 1_000_000_000_000,
};

const busySession: SessionInfo = {
	...baseSession,
	name: 'my-project',
	status: 'busy',
	updatedAt: Date.now(),   // set fresh in each test via vi.setSystemTime
};
```

### `resolveDisplayName` tests (pure, no mocking needed)

| ID | Description | Input | Expected |
|---|---|---|---|
| D1 | Uses `name` when present | `{ name: 'foo', cwd: '/a/b', sessionId: '12345678abcd' }` | `'foo'` |
| D2 | Falls back to `basename(cwd)` when no name | `{ cwd: '/home/user/my-project', sessionId: '12345678abcd' }` | `'my-project'` |
| D3 | Falls back to 8-char sessionId when cwd is root | `{ cwd: '/', sessionId: '12345678abcd' }` | `'12345678'` |
| D4 | Falls back to 8-char sessionId when cwd is empty string | `{ cwd: '', sessionId: '12345678abcd' }` | `'12345678'` |

### `resolve()` decision tree tests

| ID | Description | Setup | Expected `status` |
|---|---|---|---|
| R1 | Dead — ps fails | `isPidAlive` returns false | `SessionStatus.Dead` |
| R2 | Idle — old schema (no `status` field) | PID alive; `session.status` undefined | `SessionStatus.Idle` |
| R3 | Idle — status is not `'busy'` | PID alive; `session.status = 'idle'` | `SessionStatus.Idle` |
| R4 | Hanging — `updatedAt` older than threshold | PID alive; `status: 'busy'`; `updatedAt` set to `now - 121_000` | `SessionStatus.Hanging` |
| R5 | Hanging boundary — exactly at threshold | PID alive; `updatedAt` set to `now - 120_000` | `SessionStatus.Hanging` |
| R6 | Executing — has real child processes | PID alive; `status: 'busy'`; fresh `updatedAt`; children: `['node']` | `SessionStatus.Executing` |
| R7 | Waiting — only helper child (caffeinate) | PID alive; `status: 'busy'`; fresh `updatedAt`; children: `['caffeinate']` | `SessionStatus.Waiting` |
| R8 | Executing — caffeinate plus real child | PID alive; `status: 'busy'`; fresh `updatedAt`; children: `['caffeinate', 'bash']` | `SessionStatus.Executing` |
| R9 | Waiting — no child processes at all | PID alive; `status: 'busy'`; fresh `updatedAt`; children: `[]` | `SessionStatus.Waiting` |
| R10 | Dead session has correct displayName | `isPidAlive` false; `session.name = 'proj'` | `displayName: 'proj'` |
| R11 | `resolvedAt` is close to `Date.now()` | Any session | `resolvedAt` within 100ms of `Date.now()` |
| R12 | Multiple sessions resolved concurrently | 3 sessions with different statuses | All 3 returned; correct status each |
| R13 | Custom `hangingThresholdMs` respected | Threshold set to `30_000`; `updatedAt` is `31_000` ms old | `SessionStatus.Hanging` |
| R14 | Custom `helperProcesses` respected | Helper list set to `['node']`; only child is `'node'` | `SessionStatus.Waiting` |
