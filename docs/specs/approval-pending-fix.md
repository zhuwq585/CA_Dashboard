# Spec: Fix Approval-Pending Detection via JSONL (Issue #5)

## Problem

Sessions awaiting tool approval render as **Idle** instead of **Waiting**. During an approval prompt, Claude Code stops updating `~/.claude/sessions/<pid>.json`, so the resolver's `status !== "busy"` branch fires before the child-process check that would otherwise produce **Waiting**.

**Follow-up (Issue #14):** when a user rejects a tool-approval prompt (or interrupts the model), Claude Code appends a `user` text entry whose content is an interrupt marker — `[Request interrupted by user for tool use]` or `[Request interrupted by user]` — and the conversation halts (no follow-up API call). The classifier saw this trailing `user` entry as `userTurn` → resolver mapped it to **Executing** indefinitely. The `userInterrupted` conversation state (below) fixes this so a halted session settles to **Idle** and the dashboard highlights it.

## Solution Summary

Read the JSONL conversation log at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. The last entry reveals the conversation state, which (combined with the existing PID liveness and child-process checks) gives an unambiguous status.

This spec adds one new module, one new type, and rewrites the resolver's decision tree. The existing `~/.claude/sessions/<pid>.json` source is still used for metadata (`name`, `cwd`, `updatedAt`).

Read `docs/architecture.md` (updated in this branch) for the full revised design.

---

## Scope

| File                                      | Change                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `docs/architecture.md`                    | Update Data Source, Status Resolution, Component Architecture, Operational Edge Cases         |
| `src/types.ts`                            | Add `ConversationState` discriminated union                                                   |
| `src/jsonl/conversationLogReader.ts`      | **New** — reads JSONL tail, classifies last entry                                             |
| `src/jsonl/conversationLogReader.test.ts` | **New** — 10 tests (C1–C10)                                                                   |
| `src/resolver/statusResolver.ts`          | Rewrite decision tree to consume `ConversationState`; accept injected `ConversationLogReader` |
| `src/resolver/statusResolver.test.ts`     | Add R-J1–R-J8; update existing tests to stub `readState`                                      |

---

## types.ts addition

```typescript
export type ConversationState =
	| { kind: 'pendingToolApproval' }
	| { kind: 'assistantDone' }
	| { kind: 'userTurn' }
	| { kind: 'userInterrupted' }
	| { kind: 'unknown' };
```

---

## conversationLogReader.ts (new module)

### Public API

```typescript
export function encodeProjectPath(cwd: string): string;

export interface ConversationLogReaderOptions {
	jsonlRoot?: string; // default: path.join(os.homedir(), '.claude', 'projects')
	tailBytes?: number; // default: 64 * 1024
}

export interface ConversationStateResult {
	state: ConversationState;
	mtimeMs?: number; // present when the JSONL file was readable
}

export class ConversationLogReader {
	constructor(options?: ConversationLogReaderOptions);
	readState(cwd: string, sessionId: string): Promise<ConversationStateResult>;
}
```

### `encodeProjectPath(cwd)`

Replaces every `/` in `cwd` with `-`. No hashing.

| Input                               | Output                              |
| ----------------------------------- | ----------------------------------- |
| `/Users/syu/workspace/CA_Dashboard` | `-Users-syu-workspace-CA_Dashboard` |
| `/`                                 | `-`                                 |

### `readState(cwd, sessionId)`

1. Build path: `<jsonlRoot>/<encodeProjectPath(cwd)>/<sessionId>.jsonl`
2. `fs.stat` the file. If it does not exist → return `{ state: { kind: 'unknown' } }`.
3. Read the last `tailBytes` bytes (or whole file if smaller). If the file is larger than `tailBytes`, drop the first chunk after the first `\n` to discard a partial leading line.
4. Split by `\n`, parse each non-empty line as JSON. Discard lines that fail to parse (handles partial trailing line during a mid-write race).
5. Walk the parsed entries from end to start to find the **last successfully classified entry**:

   | Last classifiable entry                                                                                                                                                     | Returned `state.kind` |
   | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
   | `type === 'assistant'` AND `message.stop_reason === 'tool_use'` AND `message.content` includes a block with `type === 'tool_use'`; AND no later entry has `type === 'user'` | `pendingToolApproval` |
   | `type === 'assistant'` AND `message.stop_reason !== 'tool_use'` (or no `tool_use` content block)                                                                            | `assistantDone`       |
   | `type === 'user'` AND its text content is an interrupt marker (see below)                                                                                                   | `userInterrupted`     |
   | `type === 'user'` AND no later entry has `type === 'assistant'`                                                                                                             | `userTurn`            |
   | otherwise                                                                                                                                                                   | `unknown`             |

   The `userInterrupted` row takes precedence over the generic `userTurn` row. When a
   user **rejects** a tool-approval prompt — or interrupts the model mid-generation —
   Claude Code appends a `user` entry whose text content is exactly one of these
   interrupt markers:

   - `[Request interrupted by user for tool use]` — a tool approval was rejected
   - `[Request interrupted by user]` — the model was interrupted

   In both cases the conversation halts: Claude Code makes no follow-up API call and
   waits for the user's next message, so the session is idle. (If the user types a
   follow-up message, that message becomes a later `user` entry and the state classifies
   as `userTurn` again.) A `user` entry's text content may be either a plain string or
   the `text` field of a `text` block inside a `content` array — check both forms.

6. Return `{ state, mtimeMs: stat.mtimeMs }`.

Any I/O or parse error caught at the outer level returns `{ state: { kind: 'unknown' } }`.

---

## statusResolver.ts changes

### Updated public API

```typescript
export interface StatusResolverOptions {
	hangingThresholdMs?: number; // default: 7_200_000 (120 minutes)
	helperProcesses?: string[]; // default: ['caffeinate']
	logReader?: ConversationLogReader; // default: new ConversationLogReader()
}
```

`resolve(sessions: SessionInfo[]): Promise<ResolvedSession[]>` signature unchanged.

### Revised decision tree (replaces current `resolveOne`)

```
1. ps -p <pid> fails                                        →  Dead

2. const { state, mtimeMs } = await logReader.readState(cwd, sessionId)

3. ALL defined activity signals (session.updatedAt and mtimeMs) older
   than hangingThresholdMs                                  →  Hanging
   (skipped when neither timestamp is defined; either signal being
    fresh keeps the session out of Hanging)

3b. session.status === 'waiting'                            →  Waiting
    (Claude Code writes this directly when blocked on user
     approval; trust it over child-process inspection)

4. state.kind === 'pendingToolApproval'
   4a. real children exist (filtered against helperProcesses) →  Executing
   4b. otherwise                                              →  Waiting

5. state.kind === 'userTurn'                                  →  Executing

6. state.kind === 'userInterrupted'                           →  Idle
   (user rejected a tool or interrupted the model; conversation halted)

7. state.kind === 'assistantDone'                             →  Idle

8. state.kind === 'unknown'                                   →  Idle
```

The `session.status === 'busy'` check is removed. `displayName` resolution and `resolvedAt = Date.now()` are unchanged.

---

## Test Design

### conversationLogReader.test.ts

Integration-style: real temp directories, real files. No fs mocking. `os.tmpdir()` + `fs/promises`.

| ID  | Description                                                                | Expected                                        |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| C1  | `encodeProjectPath('/Users/x/y')`                                          | `'-Users-x-y'`                                  |
| C2  | `encodeProjectPath('/')`                                                   | `'-'`                                           |
| C3  | Last line: assistant `tool_use` with `tool_use` content block              | `state.kind === 'pendingToolApproval'`          |
| C4  | Last line: assistant `end_turn`                                            | `state.kind === 'assistantDone'`                |
| C5  | Last line: user message                                                    | `state.kind === 'userTurn'`                     |
| C6  | JSONL file does not exist                                                  | `state.kind === 'unknown'`                      |
| C7  | JSONL file empty                                                           | `state.kind === 'unknown'`                      |
| C8  | Trailing partial JSON (mid-write race)                                     | Skips partial line; classifies prior valid line |
| C9  | Assistant `tool_use` followed by another assistant entry (no `user` since) | `state.kind === 'pendingToolApproval'`          |
| C10 | `mtimeMs` returned matches `fs.stat` mtime                                 | `mtimeMs` defined and within ±5ms of stat       |
| C11 | Last line: `user` entry, text content `[Request interrupted by user for tool use]` | `state.kind === 'userInterrupted'`       |
| C20 | Last line: `user` entry, text content `[Request interrupted by user]`      | `state.kind === 'userInterrupted'`              |
| C21 | Interrupt marker followed by a real `user` message                        | `state.kind === 'userTurn'`                     |

### statusResolver.test.ts additions

`ConversationLogReader` is injected via `StatusResolverOptions.logReader`. Use a stub:

```typescript
const stubReader = {
	readState: vi.fn<typeof ConversationLogReader.prototype.readState>(),
} as unknown as ConversationLogReader;
```

Existing `tinyexec` mocking pattern (`vi.mock('tinyexec')`) for `ps`/`pgrep` stays.

| ID    | Description                                                                     | Setup                                                                                      | Expected    |
| ----- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| R-J1  | Approval pending, no real children                                              | state = `pendingToolApproval`, children = `['caffeinate']`                                 | `Waiting`   |
| R-J2  | Tool actively running                                                           | state = `pendingToolApproval`, children = `['bash']`                                       | `Executing` |
| R-J3  | Conversation done — assistant finished, no pending action                       | state = `assistantDone`                                                                    | `Idle`      |
| R-J4  | Model generating response                                                       | state = `userTurn`                                                                         | `Executing` |
| R-J5  | Stale JSONL mtime triggers Hanging when no `updatedAt`                          | state = `pendingToolApproval`, `mtimeMs = now - 121_000`, no `updatedAt`                   | `Hanging`   |
| R-J6  | Unknown state → Idle                                                            | state = `unknown`                                                                          | `Idle`      |
| R-J7  | Dead PID overrides JSONL                                                        | `isPidAlive` false, state = `pendingToolApproval`                                          | `Dead`      |
| R-J8  | Hanging when BOTH `updatedAt` and JSONL mtime are stale                         | state = `assistantDone`, both `now - 121_000`                                              | `Hanging`   |
| R-J9  | NOT Hanging — long-running tool (fresh `updatedAt`, stale mtime, real children) | state = `pendingToolApproval`, mtime stale, `updatedAt = now`, child `bash`                | `Executing` |
| R-J10 | NOT Hanging — approval prompt (stale `updatedAt`, fresh mtime)                  | state = `pendingToolApproval`, mtime fresh, `updatedAt = now - 121_000`, only `caffeinate` | `Waiting`   |
| R-J14 | Tool rejected / model interrupted — conversation halted                         | state = `userInterrupted`                                                                  | `Idle`      |

### Existing resolver tests

Existing tests must be updated to stub `readState`. The test fixtures should set `state: { kind: 'assistantDone' }` by default (which yields `Waiting`), then override per test where needed. Tests that exercised `session.status === 'busy'` semantics map onto the new tree as follows:

- Old "Executing — has real children" → R-J2 equivalent (state = `pendingToolApproval` + real children)
- Old "Waiting — no real children" → R-J1 equivalent
- Old "Idle — old schema" → state = `unknown` → still Idle (R-J6 covers this)
- Old "Hanging — stale `updatedAt`" → R-J8 covers this
