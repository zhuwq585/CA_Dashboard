# Spec: Dashboard UI

## Scope

| File | Purpose |
|---|---|
| `src/ui/formatters.ts` | Pure helpers: status label, relative time |
| `src/ui/WatchView.tsx` | Table of watched sessions (watch mode) |
| `src/ui/SelectView.tsx` | Interactive session picker (select mode) |
| `src/ui/SettingsView.tsx` | Poll-interval settings panel |
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

Displays a table of sessions in watch mode with a navigable cursor.

### Props

```typescript
interface WatchViewProps {
	sessions:       ResolvedSession[];        // pre-filtered to only watched + non-Dead
	cursor:         number;                   // index of highlighted row
	highlightedIds: Set<string>;              // sessions needing attention (bold + yellow)
	customNames:    Map<string, string>;      // user-assigned names, keyed by sessionId
}
```

### Rendering

```
┌──────────────────────┬────────────┬─────────────┐
│ Name                 │ Status     │ Last Active │
├──────────────────────┼────────────┼─────────────┤
│ ca-dashboard-arch    │ ⚙ Executing│ just now    │  ← cursor row (inverse)
│ InboxOwl             │ ⏳ Waiting │ 12s ago     │  ← highlighted (bold + yellow)
└──────────────────────┴────────────┴─────────────┘
[s] select sessions   [t] settings   [q] quit
```

- **Name** column: `customNames.get(sessionId) ?? session.displayName`
- **Status** column: `formatStatus(session.status)`
- **Last Active** column: `formatRelativeTime(session.sessionInfo.updatedAt)`
- **Name column width**: dynamic — fills remaining terminal width after fixed columns (`useWindowSize()`)
  - Status column: `12` chars fixed; Last Active column: `10` chars fixed
  - `nameWidth = Math.max(8, columns - 12 - 10 - 2)` (2 for padding)
- **Cursor row**: rendered with `inverse` prop
- **Highlighted rows**: rendered with `bold` + `color="yellow"` (applies alongside `inverse` when both are true)
- When `sessions` is empty: `No sessions selected. Press [s] to select.`
- Hint bar: `[s] select   [t] settings   [d] dismiss   [q] quit`

---

## SelectView.tsx

Interactive list for choosing which sessions to watch, with rename support.

### Props

```typescript
interface SelectViewProps {
	sessions:    ResolvedSession[];   // all sessions, including Dead
	checkedIds:  Set<string>;         // draft selection (not yet committed)
	cursor:      number;              // index of highlighted row
	customNames: Map<string, string>; // user-assigned names, keyed by sessionId
	isRenaming:  boolean;             // true when rename mode is active
	renameValue: string;              // current contents of rename buffer
}
```

`SelectView` is a pure renderer — it has no callbacks. All keyboard handling lives in `Dashboard` via `useInput`.

### Rendering (normal)

```
Select sessions to watch:
  [✓] ca-dashboard-arch   ⚙ Executing
  [►] InboxOwl            ⏳ Waiting       ← cursor row (highlighted)
  [ ] old-session         ✓ Idle

↑↓ navigate   space toggle   r rename   enter confirm   esc cancel
```

### Rendering (rename mode active, cursor on row 1)

```
Select sessions to watch:
  [✓] ca-dashboard-arch   ⚙ Executing
  [►] [InboxOwl_]         ⏳ Waiting       ← name replaced by input field
  [ ] old-session         ✓ Idle

enter confirm   esc cancel
```

- **Name** column: `customNames.get(sessionId) ?? session.displayName`
- **Name column width**: dynamic — `nameWidth = Math.max(8, columns - 12 - 10 - 4)` (4 for checkbox prefix)
- When `isRenaming && cursor === rowIndex`: replace name cell with `[<renameValue>_]`
- `[✓]` if `sessionId` in `checkedIds`, `[ ]` otherwise; `[►]` on cursor row
- Status shown using `formatStatus(session.status)`
- Hint bar adapts: shows rename hint when not renaming; shows confirm/cancel only when renaming

---

## SettingsView.tsx

Pure display component for the poll-interval settings panel. No keyboard handling — Dashboard owns all input.

### Props

```typescript
interface SettingsViewProps {
	intervalMs: number;
	presets:    readonly number[];
	labels:     readonly string[];
}
```

### Rendering

```
Settings

  Poll interval: [◄] 1s [►]

◄► change interval   esc back
```

- Shows the label for the current `intervalMs` (matched by value from `presets`/`labels` arrays)
- `[◄]` and `[►]` are decorative indicators for left/right navigation

---

## Dashboard.tsx

Root component. Owns all state, handles all keyboard input, renders the active view.

### Props

```typescript
interface DashboardProps {
	sessions:          ResolvedSession[];    // updated externally on every watcher tick
	onExit:            () => void;
	onIntervalChange?: (ms: number) => void; // called when poll interval changes
}
```

### Constants

```typescript
const PRESETS_MS    = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
const PRESET_LABELS = ['0.5s', '1s', '2s', '5s', '10s', '30s'] as const;

const BUSY_STATUSES      = new Set([SessionStatus.Executing, SessionStatus.Waiting]);
const ATTENTION_STATUSES = new Set([SessionStatus.Idle, SessionStatus.Hanging, SessionStatus.Dead]);
```

### State

```typescript
const [mode, setMode]             = useState<'watch' | 'select' | 'rename' | 'settings'>('watch');
const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
const [cursor, setCursor]         = useState<number>(0);
const [watchCursor, setWatchCursor] = useState<number>(0);
const [customNames, setCustomNames] = useState<Map<string, string>>(new Map());
const [renameBuffer, setRenameBuffer] = useState<string>('');
const [intervalIdx, setIntervalIdx]   = useState<number>(1);           // default: 1s
const prevStatusesRef = useRef<Map<string, SessionStatus>>(new Map());
const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
```

`watchedIds` — committed selection, persists across mode switches.  
`pendingIds` — draft copy used only during select mode; discarded on `esc`, committed on `enter`.  
`watchCursor` — cursor position in watch mode (for highlight dismissal).  
`customNames` — user-assigned display names, keyed by `sessionId`.  
`renameBuffer` — live text input during rename mode.  
`intervalIdx` — index into `PRESETS_MS` / `PRESET_LABELS`.  
`prevStatusesRef` — tracks previous statuses to detect transitions (ref, not state, to avoid extra renders).  
`highlightedIds` — sessions requiring user attention.

### Session filtering and ordering

**Before filtering**, sort sessions: highlighted first (preserving relative order), then the rest:

```typescript
const sortedSessions = [
	...sessions.filter(s => highlightedIds.has(s.sessionInfo.sessionId)),
	...sessions.filter(s => !highlightedIds.has(s.sessionInfo.sessionId)),
];
```

**Watch mode display list** (`watchSessions`), derived from `sortedSessions`:
- If `watchedIds` is empty: all sessions where `status !== Dead`
- If `watchedIds` is non-empty: sessions where `sessionId ∈ watchedIds` AND `status !== Dead`

**Select mode display list** (`selectSessions`): `sortedSessions` unfiltered (including Dead).

### Highlight detection (`useEffect` on `sessions`)

On every `sessions` prop update, compare each session's current status against the previous value stored in `prevStatusesRef`. Update `highlightedIds`:

- If `prevStatus ∈ BUSY_STATUSES` and `newStatus ∈ ATTENTION_STATUSES` → add to `highlightedIds`
- If status changed for any other reason → remove from `highlightedIds` (auto-clear)
- Sessions not yet seen (first render) are skipped

After processing, update `prevStatusesRef` with current statuses.

### Keyboard handling (via Ink's `useInput`)

**Watch mode:**

| Key | Action |
|---|---|
| `↑` or `k` | Move `watchCursor` up, clamp to `[0, watchSessions.length - 1]` |
| `↓` or `j` | Move `watchCursor` down, clamp to `[0, watchSessions.length - 1]` |
| `d` | Remove `watchSessions[watchCursor].sessionInfo.sessionId` from `highlightedIds` |
| `s` | Copy `watchedIds` → `pendingIds`; reset `cursor` to `0`; `mode = 'select'` |
| `t` | `mode = 'settings'` |
| `q` | Call `onExit()` |

**Select mode:**

| Key | Action |
|---|---|
| `↑` or `k` | `cursor = (cursor - 1 + n) % n` |
| `↓` or `j` | `cursor = (cursor + 1) % n` |
| `space` | Toggle `selectSessions[cursor].sessionId` in `pendingIds` |
| `r` | Pre-fill `renameBuffer` with current display name of cursor row; `mode = 'rename'` |
| `return` | Set `watchedIds = pendingIds`; `mode = 'watch'` |
| `escape` | Discard `pendingIds`; `mode = 'watch'` |

**Rename mode:**

| Key | Action |
|---|---|
| Printable char | Append to `renameBuffer` |
| Backspace (`\x7f`) | Remove last char from `renameBuffer` |
| `return` | Save `renameBuffer.trim()` into `customNames` keyed by `sessionId`; `mode = 'select'` |
| `escape` | Discard buffer; `mode = 'select'` |

**Settings mode:**

| Key | Action |
|---|---|
| `←` or `h` | Decrement `intervalIdx`, clamp at `0`; call `onIntervalChange?.(PRESETS_MS[intervalIdx])` |
| `→` or `l` | Increment `intervalIdx`, clamp at `PRESETS_MS.length - 1`; call `onIntervalChange?.(PRESETS_MS[intervalIdx])` |
| `escape` | `mode = 'watch'` |

### Cursor bounds

When `sessions` prop updates while in select mode, clamp `cursor` to `max(0, selectSessions.length - 1)`.

---

## SessionFileWatcher — new method

Add `setTickInterval(ms: number): void` to `SessionFileWatcher`. Clears the existing tick timer and recreates it with the new interval. Safe to call at any time; has no effect if the watcher is not running.

```typescript
setTickInterval(ms: number): void {
	if (this.tickTimer !== null) {
		clearInterval(this.tickTimer);
	}
	this.tickTimer = setInterval(() => {
		void this.scan().then(sessions => {
			if (this.active && this.onChanged) this.onChanged(sessions);
		});
	}, ms);
}
```

---

## src/index.ts

Entry point. Wires the three components together and starts the app. No unit tests — this is integration wiring only.

```typescript
import { render } from 'ink';
import React from 'react';
import type { ResolvedSession } from './types.js';
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
		onIntervalChange: (ms) => watcher.setTickInterval(ms),
	})
);
rerender = _rerender;

watcher.start(async (sessionInfos) => {
	currentSessions = await resolver.resolve(sessionInfos);
	rerender(React.createElement(Dashboard, {
		sessions: currentSessions,
		onExit: () => { watcher.stop(); unmount(); process.exit(0); },
		onIntervalChange: (ms) => watcher.setTickInterval(ms),
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

**Watch mode — cursor and highlight**

| ID | Description | Action | Assert |
|---|---|---|---|
| U22 | `↓` moves watch cursor down | render 2 sessions; press `↓` | second row rendered with `inverse` |
| U23 | `↑` moves watch cursor up from row 1 | press `↓` then `↑` | first row rendered with `inverse` |
| U24 | Watch cursor clamped at bottom | cursor at last; press `↓` | cursor stays on last row |
| U25 | Watch cursor clamped at top | cursor at 0; press `↑` | cursor stays on row 0 |
| U26 | `t` enters settings mode | press `t` | `'Poll interval'` in frame |
| U27 | `t` in select mode has no effect | enter select; press `t` | frame still shows select view |

**Rename mode**

| ID | Description | Action | Assert |
|---|---|---|---|
| U28 | `r` in watch mode has no effect | press `r` | watch view still shown |
| U29 | `r` in select mode enters rename mode, shows input field | enter select; press `r` | `[` and `_]` in frame (input field) |
| U30 | Typing in rename mode appends to buffer | enter rename; type `foo` | `[foo_]` in frame |
| U31 | Backspace removes last char | enter rename; type `ab`; press `\x7f` | `[a_]` in frame |
| U32 | Enter confirms rename, returns to select mode | rename to `myname`; press `return` | `myname` shown in select view; input field gone |
| U33 | Escape discards rename, returns to select | rename buffer `abc`; press `esc` | original name shown; input field gone |
| U34 | Confirmed custom name appears in watch view | rename session; confirm; press `esc` to watch | custom name visible in watch view |

**Dynamic column widths**

| ID | Description | Setup | Assert |
|---|---|---|---|
| U35 | Wide terminal — name column wider than 8 | `columns = 200` via `useWindowSize` mock | name column `width > 8` (more chars visible) |
| U36 | Narrow terminal — name column at minimum | `columns = 30` | name column at minimum (8 chars) |

**Settings mode**

| ID | Description | Action | Assert |
|---|---|---|---|
| U37 | `t` in watch mode enters settings mode | press `t` | `'Poll interval'` in frame |
| U38 | Settings view renders current interval label | enter settings (default 1s) | `'1s'` in frame |
| U39 | `→` increments interval | enter settings; press `→` | `'2s'` in frame |
| U40 | `←` decrements interval | enter settings; press `→` then `←` | `'1s'` in frame |
| U41 | `←` at min does not go below 0 | enter settings; press `←` 10 times | `'0.5s'` in frame |
| U42 | `→` at max does not exceed max | enter settings; press `→` 10 times | `'30s'` in frame |
| U43 | Escape returns to watch mode | enter settings; press `esc` | watch view shown |
| U44 | `onIntervalChange` fires when interval changes | press `→` in settings | callback called with new ms value |

**Status-change highlight**

| ID | Description | Setup | Assert |
|---|---|---|---|
| U45 | Highlighted sessions sorted to top | `[idle-A, executing-B]`; B transitions to `Idle`; rerender with B highlighted | B row appears before A row |
| U46 | Row highlighted on `Executing` → `Idle` transition | render executing session; rerender as idle | row rendered with `bold`/`yellow` indicators |
| U47 | Row highlighted on `Waiting` → `Hanging` transition | render waiting session; rerender as hanging | row rendered with highlight |
| U48 | Highlight auto-clears on status change back to busy | highlight session; rerender as executing | row no longer highlighted |
| U49 | `d` dismisses highlight on cursor row | highlight session at watchCursor 0; press `d` | row no longer highlighted |
| U50 | Non-transitioning session not highlighted | render session; rerender same status | no highlight indicators |

---

## UI Improvements Round 2

### Vertical scroll

When the session list exceeds terminal height, each view scrolls so the cursor row is always visible.

**Scroll formula** (used in `WatchView` and `SelectView`):

```typescript
const { columns, rows } = useWindowSize();
const FIXED_ROWS = /* view-specific */;
const visibleCount  = Math.max(1, rows - FIXED_ROWS);
const maxOffset     = Math.max(0, sessions.length - visibleCount);
const idealOffset   = cursor - Math.floor(visibleCount / 2);
const scrollOffset  = Math.max(0, Math.min(maxOffset, idealOffset));
const visibleSessions = sessions.slice(scrollOffset, scrollOffset + visibleCount);
```

In the row map loop, `isCursor` compares `scrollOffset + i === cursor` (full-array index, not slice index).

**Scroll indicators** — shown when content is cut off:

- `↑ N more` above the list when `scrollOffset > 0`
- `↓ N more` below the list when `scrollOffset + visibleCount < sessions.length`

`FIXED_ROWS` constants:
- `WatchView`: 6 (title 1 + scroll-top 1 + scroll-bottom 1 + hint 1 + status-counts 1 + padding 1)
- `SelectView`: 5 (title 1 + header 1 + scroll-top 1 + scroll-bottom 1 + hint 1)

### Quick hide (`x` key in watch mode)

Pressing `x` in watch mode hides the cursor session from the watch view without entering select mode.

- New state `hiddenIds: Set<string>` in `Dashboard`
- `watchSessions` filter excludes hidden sessions (applied after watchedIds/Dead filter)
- In select mode, hidden sessions show `[~]` checkbox marker (instead of `[ ]` or `[✓]`)
- Pressing `space` on a `[~]` row removes the session from `hiddenIds` and adds it to `pendingIds`
- `x` in select/rename/settings mode has no effect
- Hint bar updated: `[x] hide` added

### Pre-select visible sessions

When pressing `s` to enter select mode, `pendingIds` is pre-filled with the IDs of all currently visible watch-view sessions (those that would show without further interaction):

```typescript
// Old:
setPendingIds(new Set(watchedIds));
// New:
setPendingIds(new Set(watchSessions.map(s => s.sessionInfo.sessionId)));
```

This means entering select starts with all visible sessions checked, and the user deselects what they don't want.

### Title bar

`Dashboard` renders `<Text bold>CA Dashboard</Text>` above every view using a wrapper `<Box flexDirection="column">`. This means the title appears in all modes (watch, select/rename, settings) without each view needing to know about it.

### Status counts

`WatchView` receives an `allSessions: ResolvedSession[]` prop (the raw unfiltered session list from `Dashboard`). It computes per-status counts and renders them below the hint bar:

```
1 executing · 2 waiting · 1 idle
```

- Order: `Executing · Waiting · Idle · Hanging · Dead`
- Only statuses with count > 0 are shown
- Rendered `dimColor`
- Uses ALL sessions, not just the filtered watch list

### Test cases (V1–V11)

**Vertical scroll (V1–V3)**

| ID | Description | Action | Assert |
|---|---|---|---|
| V1 | With 20 sessions, only a subset is rendered | render 20 sessions | `visibleCount < 20` |
| V2 | Moving cursor down scrolls viewport | press `j` 15 times with 20 sessions | `scroll-sess-15` visible in frame |
| V3 | `↓` indicator appears when content overflows below | render 20 sessions | frame contains `↓` |

**Quick hide (V4–V7)**

| ID | Description | Action | Assert |
|---|---|---|---|
| V4 | `x` hides cursor session from watch view | render 2 sessions; press `x` | hidden session no longer in frame |
| V5 | Hidden session shows `[~]` in select mode | hide session; enter select; navigate cursor away | `[~]` in frame |
| V6 | Space on `[~]` row unhides and checks session | hide session; enter select; press `space` | `[~]` gone; `[✓]` present |
| V7 | `x` in select mode has no effect | enter select; press `x` | frame unchanged |

**Pre-select (V8)**

| ID | Description | Action | Assert |
|---|---|---|---|
| V8 | Entering select pre-checks all visible sessions | enter select | no `[ ]` in frame (all checked or cursor) |

**Title bar (V9)**

| ID | Description | Action | Assert |
|---|---|---|---|
| V9 | `CA Dashboard` appears in all modes | check watch, select, settings modes | `CA Dashboard` in each frame |

**Status counts (V10–V11)**

| ID | Description | Action | Assert |
|---|---|---|---|
| V10 | Status count bar shows correct counts | render exec + wait + idle | `1 executing`, `1 waiting`, `1 idle` in frame |
| V11 | Counts reflect ALL sessions, not just watched | commit a subset; dead session excluded from watch | `1 dead` still in frame |
