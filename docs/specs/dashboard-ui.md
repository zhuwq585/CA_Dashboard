# Spec: Dashboard UI

## Scope

Four source files:

| File | Purpose |
|---|---|
| `src/ui/formatters.ts` | Pure helpers: status label, relative time |
| `src/ui/WatchView.tsx` | Table of watched sessions (watch mode) |
| `src/ui/SelectView.tsx` | Interactive session picker (select mode) |
| `src/ui/Dashboard.tsx` | Root component: state, keyboard, mode routing |
| `src/index.ts` | Entry point: wires watcher + resolver + UI |

Read `docs/architecture.md`, `docs/specs/session-watcher-types.md`, and `docs/specs/status-resolver.md` before implementing.

## Packages to install before implementing

```bash
npm install ink react
npm install --save-dev @types/react ink-testing-library
```

---

## APIs reused from previous features

Import — do not redefine:

```typescript
import { SessionInfo, SessionStatus, ResolvedSession } from '../types.js';
import { SessionFileWatcher } from '../watcher/sessionFileWatcher.js';
import { StatusResolver } from '../resolver/statusResolver.js';
```

---

## formatters.ts

Pure functions, no Ink dependency, no side effects.

```typescript
export function formatStatus(status: SessionStatus): string;
export function formatRelativeTime(epochMs: number | undefined): string;
```

### `formatStatus(status)`

| Status | Return value |
|---|---|
| `SessionStatus.Executing` | `'⚙ Executing'` |
| `SessionStatus.Waiting` | `'⏳ Waiting'` |
| `SessionStatus.Idle` | `'✓ Idle'` |
| `SessionStatus.Hanging` | `'⚠ Hanging'` |
| `SessionStatus.Dead` | `'✗ Dead'` |

### `formatRelativeTime(epochMs)`

Computes age as `Date.now() - epochMs` and returns:

| Age | Return value |
|---|---|
| `undefined` | `'unknown'` |
| `< 10_000 ms` | `'just now'` |
| `< 60_000 ms` | `'{n}s ago'` where n = floor(age / 1000) |
| `< 3_600_000 ms` | `'{n}m ago'` where n = floor(age / 60_000) |
| `>= 3_600_000 ms` | `'{n}h ago'` where n = floor(age / 3_600_000) |

---

## WatchView.tsx

Displays a table of sessions in watch mode.

### Props

```typescript
interface WatchViewProps {
	sessions: ResolvedSession[];  // pre-filtered to only watched + non-Dead
}
```

### Rendering

```
┌──────────────────────┬────────────┬─────────────┐
│ Name                 │ Status     │ Last Active │
├──────────────────────┼────────────┼─────────────┤
│ ca-dashboard-arch    │ ⚙ Executing│ just now    │
│ InboxOwl             │ ⏳ Waiting │ 12s ago     │
└──────────────────────┴────────────┴─────────────┘
[s] select sessions   [q] quit
```

- **Name** column: `session.displayName`
- **Status** column: `formatStatus(session.status)`
- **Last Active** column: `formatRelativeTime(session.sessionInfo.updatedAt)`
- When `sessions` is empty, show: `No sessions selected. Press [s] to select.`
- Hint bar always shown below the table: `[s] select sessions   [q] quit`

---

## SelectView.tsx

Interactive list for choosing which sessions to watch.

### Props

```typescript
interface SelectViewProps {
	sessions: ResolvedSession[];  // all sessions, including Dead
	checkedIds: Set<string>;      // draft selection (not yet committed)
	cursor: number;               // index of highlighted row
	onCursorMove: (delta: -1 | 1) => void;
	onToggle: () => void;
	onConfirm: () => void;
	onCancel: () => void;
}
```

### Rendering

```
Select sessions to watch:
  [✓] ca-dashboard-arch   ⚙ Executing
  [►] InboxOwl            ⏳ Waiting       ← cursor row (highlighted)
  [ ] old-session         ✓ Idle

↑↓ navigate   space toggle   enter confirm   esc cancel
```

- `[✓]` if `sessionId` is in `checkedIds`, `[ ]` otherwise
- `[►]` prefix replaces `[ ]`/`[✓]` on the cursor row to show current position
- Status shown using `formatStatus(session.status)`
- Hint bar always shown at the bottom

---

## Dashboard.tsx

Root component. Owns all state, handles all keyboard input, renders either `WatchView` or `SelectView`.

### Props

```typescript
interface DashboardProps {
	sessions: ResolvedSession[];  // updated externally on every watcher tick
	onExit: () => void;
}
```

### State

```typescript
const [mode, setMode]           = useState<'watch' | 'select'>('watch');
const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
const [cursor, setCursor]       = useState<number>(0);
```

`watchedIds` — committed selection, persists across mode switches.
`pendingIds` — draft copy used only during select mode; discarded on `esc`, committed on `enter`.

### Session filtering

**Watch mode display list** (`watchSessions`):
- If `watchedIds` is empty: all sessions where `status !== Dead`
- If `watchedIds` is non-empty: sessions where `sessionId ∈ watchedIds` AND `status !== Dead`

**Select mode display list** (`selectSessions`): all sessions (including Dead), no filtering.

### Keyboard handling (via Ink's `useInput`)

**Watch mode:**

| Key | Action |
|---|---|
| `s` | Copy `watchedIds` into `pendingIds`; reset `cursor` to `0`; set `mode = 'select'` |
| `q` | Call `onExit()` |

**Select mode:**

| Key | Action |
|---|---|
| `↑` or `k` | `onCursorMove(-1)`: cursor = (cursor - 1 + n) % n |
| `↓` or `j` | `onCursorMove(1)`: cursor = (cursor + 1) % n |
| `space` | Toggle `selectSessions[cursor].sessionId` in `pendingIds` |
| `return` | Set `watchedIds = pendingIds`; set `mode = 'watch'` |
| `escape` | Discard `pendingIds`; set `mode = 'watch'` |

### Cursor bounds

When `sessions` prop updates while in select mode, clamp `cursor` to `max(0, sessions.length - 1)` to prevent out-of-bounds.

---

## src/index.ts

Entry point. Wires the three components together and starts the app. No unit tests — this is integration wiring only.

```typescript
import { render } from 'ink';
import React from 'react';
import { SessionFileWatcher } from './watcher/sessionFileWatcher.js';
import { StatusResolver } from './resolver/statusResolver.js';
import { Dashboard } from './ui/Dashboard.js';

const watcher  = new SessionFileWatcher();
const resolver = new StatusResolver();

let currentSessions: ResolvedSession[] = [];
let rerender: ReturnType<typeof render>['rerender'];

const { rerender: _rerender, unmount } = render(
	React.createElement(Dashboard, {
		sessions: currentSessions,
		onExit: () => { watcher.stop(); unmount(); process.exit(0); },
	})
);
rerender = _rerender;

watcher.start(async (sessionInfos) => {
	currentSessions = await resolver.resolve(sessionInfos);
	rerender(React.createElement(Dashboard, {
		sessions: currentSessions,
		onExit: () => { watcher.stop(); unmount(); process.exit(0); },
	}));
});
```

Note: `rerender` keeps the same `Dashboard` instance alive; state inside `Dashboard` is preserved across session updates.

---

## Test Design

### Test files

| Source file | Test file |
|---|---|
| `src/ui/formatters.ts` | `src/ui/formatters.test.ts` |
| `src/ui/Dashboard.tsx` + views | `src/ui/Dashboard.test.tsx` |

`src/index.ts` — no unit tests (integration wiring).

### Test environment

- **Runner**: Vitest
- **Component testing**: `ink-testing-library` (`render` → inspects `.lastFrame()`)
- **Keyboard simulation**: `ink-testing-library`'s `stdin.write(key)` or `userEvent` equivalent
- **Time control**: `vi.setSystemTime()` for `formatRelativeTime` tests

### Fixtures

```typescript
const makeSession = (
	overrides: Partial<ResolvedSession> = {}
): ResolvedSession => ({
	sessionInfo: {
		pid: 1000,
		sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
		cwd: '/home/user/project-a',
		startedAt: 1_000_000_000_000,
		updatedAt: Date.now() - 5_000,
	},
	status: SessionStatus.Waiting,
	displayName: 'project-a',
	resolvedAt: Date.now(),
	...overrides,
});

const executingSession = makeSession({ status: SessionStatus.Executing, displayName: 'proj-exec' });
const waitingSession   = makeSession({ status: SessionStatus.Waiting,   displayName: 'proj-wait' });
const idleSession      = makeSession({ status: SessionStatus.Idle,      displayName: 'proj-idle' });
const hangingSession   = makeSession({ status: SessionStatus.Hanging,   displayName: 'proj-hang' });
const deadSession      = makeSession({ status: SessionStatus.Dead,      displayName: 'proj-dead' });
```

---

### formatters.ts tests (`src/ui/formatters.test.ts`)

**`formatStatus`**

| ID | Input | Expected output |
|---|---|---|
| F1 | `SessionStatus.Executing` | `'⚙ Executing'` |
| F2 | `SessionStatus.Waiting` | `'⏳ Waiting'` |
| F3 | `SessionStatus.Idle` | `'✓ Idle'` |
| F4 | `SessionStatus.Hanging` | `'⚠ Hanging'` |
| F5 | `SessionStatus.Dead` | `'✗ Dead'` |

**`formatRelativeTime`** — set `vi.setSystemTime(1_000_000_000_000)` in `beforeEach`

| ID | `epochMs` | Expected output |
|---|---|---|
| F6 | `undefined` | `'unknown'` |
| F7 | `now - 0` | `'just now'` |
| F8 | `now - 9_999` | `'just now'` |
| F9 | `now - 10_000` | `'10s ago'` |
| F10 | `now - 59_000` | `'59s ago'` |
| F11 | `now - 60_000` | `'1m ago'` |
| F12 | `now - 119_000` | `'1m ago'` |
| F13 | `now - 3_600_000` | `'1h ago'` |
| F14 | `now - 7_200_000` | `'2h ago'` |

---

### Dashboard component tests (`src/ui/Dashboard.test.tsx`)

**Watch mode — display**

| ID | Description | Setup | Assert on `lastFrame()` |
|---|---|---|---|
| U1 | Shows all non-Dead sessions when `watchedIds` empty | `[executing, waiting, idle, dead]` | `proj-exec`, `proj-wait`, `proj-idle` present; `proj-dead` absent |
| U2 | Shows only selected sessions when `watchedIds` non-empty | `watchedIds={proj-exec.sessionId}` | Only `proj-exec` present |
| U3 | Dead session excluded even if in `watchedIds` | `watchedIds` includes dead session's id | `proj-dead` absent |
| U4 | Status labels rendered | `[executing]` | `'⚙ Executing'` in frame |
| U5 | Empty state message shown | `sessions=[]` | `'No sessions selected'` in frame |
| U6 | Hint bar shown | any sessions | `'[s]'` and `'[q]'` in frame |

**Watch mode — keyboard**

| ID | Description | Action | Assert |
|---|---|---|---|
| U7 | `q` calls `onExit` | press `q` | `onExit` spy called once |
| U8 | `s` switches to select mode | press `s` | `'Select sessions'` in frame |

**Select mode — display**

| ID | Description | Setup | Assert |
|---|---|---|---|
| U9 | All sessions listed including Dead | `[executing, dead]` | Both display names present |
| U10 | Unchecked sessions show `[ ]` | no preselection | `[ ]` in frame |
| U11 | Checked sessions show `[✓]` | enter select; toggle first; inspect | `[✓]` in frame |
| U12 | Cursor row shows `[►]` | default cursor at 0 | `[►]` next to first item |
| U13 | Hint bar shown | enter select mode | `'↑↓'` and `'enter'` and `'esc'` in frame |

**Select mode — keyboard**

| ID | Description | Action | Assert |
|---|---|---|---|
| U14 | `↓` moves cursor down | press `↓` | `[►]` next to second item |
| U15 | `↑` wraps cursor to bottom | cursor at 0; press `↑` | `[►]` next to last item |
| U16 | `↓` wraps cursor to top | cursor at last; press `↓` | `[►]` next to first item |
| U17 | `space` toggles item on | cursor on item A; press `space` | `[✓]` next to A |
| U18 | `space` toggles item off | cursor on checked A; press `space` | `[ ]` next to A |
| U19 | `enter` commits selection, returns to watch mode | select A; press `enter` | watch mode shown; only A visible |
| U20 | `esc` discards selection, returns to watch mode | select A; press `esc` | watch mode shown; A not selected |
| U21 | Previously committed selection preserved on `esc` | commit B; enter select; select A; press `esc` | only B shown in watch mode |
