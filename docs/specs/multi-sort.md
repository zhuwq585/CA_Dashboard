# Spec: Multi-Sort Support

## Scope

| File | Change |
|---|---|
| `src/ui/Dashboard.tsx` | Add `SortMethod` type + constants; add `sortMethod` + `settingsCursor` state; replace sort logic; update settings handler |
| `src/ui/SettingsView.tsx` | Add Sort method row; add `settingsCursor` prop |
| `src/ui/Dashboard.test.tsx` | Update U45; add S1–S26 |

## Dependencies

Reads: `docs/architecture.md`, existing `docs/specs/dashboard-ui.md`
No new npm packages required.

---

## Background

Two changes ship together because they interact:

1. **Multi-sort** — user picks Time / Status / Name in Settings. Order applies globally to both watch mode and select mode.
2. **Highlight position fix** — highlighted sessions no longer float to top; sort method controls position. Highlight is color-only (yellow + bold).

---

## 1. `src/ui/Dashboard.tsx` Changes

### 1a. New module-level constants

`SortMethod` is defined locally in `Dashboard.tsx` — it is UI-only state owned entirely by Dashboard. `SettingsView` receives plain `string` props, so no import of `SortMethod` is needed there.

Add after `ATTENTION_STATUSES`:

```ts
const SortMethod = { Time: 'time', Status: 'status', Name: 'name' } as const;
type SortMethod = typeof SortMethod[keyof typeof SortMethod];

const STATUS_RANK: Record<SessionStatus, number> = {
	[SessionStatus.Executing]: 0,
	[SessionStatus.Waiting]:   1,
	[SessionStatus.Idle]:      2,
	[SessionStatus.Hanging]:   3,
	[SessionStatus.Dead]:      4,
};

const SORT_METHODS: SortMethod[] = [SortMethod.Time, SortMethod.Status, SortMethod.Name];

const SORT_LABELS: Record<SortMethod, string> = {
	[SortMethod.Time]:   'Time',
	[SortMethod.Status]: 'Status',
	[SortMethod.Name]:   'Name',
};
```

### 1b. New state variables

Add after `hiddenIds`:

```ts
const [sortMethod, setSortMethod]         = useState<SortMethod>(SortMethod.Time);
const [settingsCursor, setSettingsCursor] = useState<number>(0);
```

### 1c. Replace `sortedSessions` computation

Remove the float-to-top block (current lines 53–57):

```ts
// REMOVE:
const sortedSessions = [
	...sessions.filter(s => highlightedIds.has(s.sessionInfo.sessionId)),
	...sessions.filter(s => !highlightedIds.has(s.sessionInfo.sessionId)),
];
```

Replace with:

```ts
const sortedSessions = [...sessions].sort((a, b) => {
	if (sortMethod === SortMethod.Time) {
		const ta = a.lastActiveMs ?? a.sessionInfo.updatedAt ?? 0;
		const tb = b.lastActiveMs ?? b.sessionInfo.updatedAt ?? 0;
		return tb - ta;
	}
	if (sortMethod === SortMethod.Status) {
		return STATUS_RANK[a.status] - STATUS_RANK[b.status];
	}
	return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
});
```

The `useEffect` that populates `highlightedIds` is **unchanged** — it still detects busy→attention transitions. The only behavioral change is that `highlightedIds` no longer affects position.

Notes:
- `[...sessions]` spreads a shallow copy before `.sort()` so the prop array is never mutated.
- Time sort: `lastActiveMs` (most accurate signal from resolver) → `updatedAt` → `0` (sessions with no timestamp sink to the bottom).
- Status sort: uses `STATUS_RANK` for O(1) comparison. Node.js 12+ `Array.prototype.sort` is stable, so sessions within the same status bucket retain their relative input order.
- Name sort: `sensitivity: 'base'` makes it case- and accent-insensitive, matching user expectation for directory/project names.

### 1d. Replace settings-mode keyboard handler

```ts
} else if (mode === 'settings') {
	if (key.upArrow || input === 'k') {
		setSettingsCursor(c => Math.max(0, c - 1));
	} else if (key.downArrow || input === 'j') {
		setSettingsCursor(c => Math.min(1, c + 1));
	} else if (key.leftArrow || input === 'h') {
		if (settingsCursor === 0) {
			const newIdx = Math.max(0, intervalIdx - 1);
			if (newIdx !== intervalIdx) { setIntervalIdx(newIdx); onIntervalChange?.(PRESETS_MS[newIdx]); }
		} else {
			setSortMethod(m => {
				const idx = SORT_METHODS.indexOf(m);
				return SORT_METHODS[(idx - 1 + SORT_METHODS.length) % SORT_METHODS.length];
			});
		}
	} else if (key.rightArrow || input === 'l') {
		if (settingsCursor === 0) {
			const newIdx = Math.min(PRESETS_MS.length - 1, intervalIdx + 1);
			if (newIdx !== intervalIdx) { setIntervalIdx(newIdx); onIntervalChange?.(PRESETS_MS[newIdx]); }
		} else {
			setSortMethod(m => {
				const idx = SORT_METHODS.indexOf(m);
				return SORT_METHODS[(idx + 1) % SORT_METHODS.length];
			});
		}
	} else if (key.escape) {
		setMode('watch');
	}
}
```

**Key bindings in settings mode:**

| Key | Action |
|---|---|
| `↑` / `k` | Move `settingsCursor` up; clamp at 0 |
| `↓` / `j` | Move `settingsCursor` down; clamp at 1 |
| `←` / `h` | If row 0: decrement `intervalIdx`; if row 1: cycle sort backward |
| `→` / `l` | If row 0: increment `intervalIdx`; if row 1: cycle sort forward |
| `esc` | Return to watch mode |

**Sort method cycle order:** Time → Status → Name → Time (wraps in both directions).

`settingsCursor` is not reset when leaving settings — resuming at the same row is better UX.

### 1e. Update `<SettingsView>` JSX

```tsx
<SettingsView
	intervalMs={PRESETS_MS[intervalIdx]}
	presets={PRESETS_MS}
	labels={PRESET_LABELS}
	sortMethod={sortMethod}
	sortLabels={SORT_LABELS}
	settingsCursor={settingsCursor}
/>
```

---

## 2. `src/ui/SettingsView.tsx` Changes

### New props interface

`SettingsView` is purely presentational and does not import `SortMethod`. Props use plain `string` types:

```ts
interface SettingsViewProps {
	intervalMs:     number;
	presets:        readonly number[];
	labels:         readonly string[];
	sortMethod:     string;
	sortLabels:     Record<string, string>;
	settingsCursor: number;   // 0 = Poll interval row, 1 = Sort method row
}
```

### Render output

When `settingsCursor === 0`:

```
Settings

► Poll interval:  [◄] 1s [►]
  Sort method:    [◄] Time [►]

↑↓ select   ◄► change   esc back
```

When `settingsCursor === 1`:

```
Settings

  Poll interval:  [◄] 1s [►]
► Sort method:    [◄] Status [►]

↑↓ select   ◄► change   esc back
```

### Implementation

```tsx
export function SettingsView({
	intervalMs, presets, labels, sortMethod, sortLabels, settingsCursor,
}: SettingsViewProps): React.ReactElement {
	const intervalIdx   = presets.indexOf(intervalMs);
	const intervalLabel = intervalIdx >= 0 ? labels[intervalIdx] : `${intervalMs}ms`;
	const sortLabel     = sortLabels[sortMethod] ?? sortMethod;
	const prefix        = (row: number) => settingsCursor === row ? '► ' : '  ';

	return (
		<Box flexDirection="column">
			<Text>Settings</Text>
			<Text> </Text>
			<Text>{prefix(0)}Poll interval:  [◄] {intervalLabel} [►]</Text>
			<Text>{prefix(1)}Sort method:    [◄] {sortLabel} [►]</Text>
			<Text> </Text>
			<Text>↑↓ select   ◄► change   esc back</Text>
		</Box>
	);
}
```

---

## 3. Highlight Behavior Change

**Before:** highlighted sessions floated to the top of the list.
**After:** highlighted sessions stay in their sort-method position; only font color/weight changes (yellow + bold).

The `d` key to dismiss a highlight is unchanged. `WatchView`'s yellow+bold rendering is unchanged.

---

## 4. Test Design

Test file: `src/ui/Dashboard.test.tsx`

### Fixtures

Add alongside the existing `makeSession()` factory:

```ts
const makeTimedSession = (
	displayName:  string,
	sessionId:    string,
	status:       SessionStatus,
	lastActiveMs: number,
): ResolvedSession => ({
	sessionInfo: {
		pid: 9000, sessionId, cwd: `/home/${displayName}`,
		startedAt: 1_000_000_000_000, kind: 'interactive', entrypoint: 'cli',
	},
	status,
	displayName,
	resolvedAt: Date.now(),
	lastActiveMs,
});
```

### Update U45

U45 currently asserts that a highlighted session floats to the top. Update it to assert the new behavior:

```
U45 (revised): highlighted session does NOT move above a session with a more recent timestamp.
Setup:  Default sortMethod (Time).
        session A: displayName='stable',   lastActiveMs=now-1000,  status=Idle.
        session B: displayName='exec',     lastActiveMs=now-60000, status=Executing.
        Rerender with B status=Idle (triggers highlight).
Assert: 'stable' appears before 'exec' in the frame (Time sort preserved).
```

### New test cases

#### Sort — Time (S1–S4)

| ID | Description | Setup | Assert |
|---|---|---|---|
| S1 | Most recent first | Three sessions: lastActiveMs=now-1s, now-5s, now-60s | Rendered order: 1s → 5s → 60s |
| S2 | `lastActiveMs` takes priority over `updatedAt` | A: lastActiveMs=now-1s, updatedAt=now-60s; B: no lastActiveMs, updatedAt=now-2s | A before B |
| S3 | Sessions with no timestamp appear last | Session with undefined lastActiveMs and updatedAt | Appears after all timestamped sessions |
| S4 | Time sort is default on mount | Three sessions with different lastActiveMs | Newest appears first without any user input |

#### Sort — Status (S5–S6)

| ID | Description | Setup | Assert |
|---|---|---|---|
| S5 | Correct group order | Sessions with statuses: Dead, Idle, Hanging, Executing, Waiting | Order: Executing → Waiting → Idle → Hanging → Dead |
| S6 | Stable within same status | Two Idle sessions `a`, `b` passed in that order | `a` appears before `b` |

#### Sort — Name (S7–S8)

| ID | Description | Setup | Assert |
|---|---|---|---|
| S7 | Alphabetical ascending | Sessions: `zebra`, `apple`, `Mango` | `apple` → `Mango` → `zebra` |
| S8 | Case-insensitive | Sessions: `Beta`, `alpha`, `GAMMA` | `alpha` → `Beta` → `GAMMA` |

#### Sort auto-update on status change (S9–S10)

| ID | Description | Setup | Assert |
|---|---|---|---|
| S9 | Status sort updates when session transitions | Status sort; A=Idle, B=Executing; rerender B as Dead | B appears after A |
| S10 | Time sort updates when `lastActiveMs` changes | Two sessions; rerender with swapped `lastActiveMs` values | Order reverses |

#### Settings navigation — sort method (S11–S23)

| ID | Description | Action | Assert |
|---|---|---|---|
| S11 | Settings shows Sort method row | Press `t` | Frame contains "Sort method" |
| S12 | Default sort label shown | Press `t` | Frame contains "Time" |
| S13 | `↓` moves cursor to sort row | `t`, `↓` | `►` on Sort method row |
| S14 | `↑` moves cursor back to interval row | `t`, `↓`, `↑` | `►` on Poll interval row |
| S15 | `→` cycles Time→Status | `t`, `↓`, `→` | Frame contains "Status" |
| S16 | `→` cycles Status→Name | `t`, `↓`, `→`, `→` | Frame contains "Name" |
| S17 | `→` wraps Name→Time | `t`, `↓`, `→`, `→`, `→` | Frame contains "Time" |
| S18 | `←` cycles Time→Name (backward wrap) | `t`, `↓`, `←` | Frame contains "Name" |
| S19 | Sort takes effect in watch mode | Cycle to Name, `esc`; render `[cherry, apple, banana]` | `apple` appears first |
| S20 | `→` on sort row does not affect interval | `t`, `↓` (cursor=1), `→` | Interval label unchanged |
| S21 | `←`/`→` on interval row still work | `t`, cursor stays at 0, `→` | Interval increments |
| S22 | `↑` clamps at row 0 | `t`, `↑` ×5 | Still on Poll interval row |
| S23 | `↓` clamps at row 1 | `t`, `↓` ×5 | Still on Sort method row |

#### Highlight color-only (S24–S26)

| ID | Description | Setup | Assert |
|---|---|---|---|
| S24 | Highlighted session still bold+yellow | Transition Executing→Idle; default Time sort | Row contains yellow color marker |
| S25 | Highlighted session does not move above a newer session | Stable: lastActiveMs=now-1s; highlighted: lastActiveMs=now-60s, transitions → Idle | highlighted row index > stable row index |
| S26 | Highlighted Idle stays behind Executing in Status sort | Status sort; Idle session highlighted, Executing session not | Highlighted Idle appears after Executing |

---

## 5. Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Where `SortMethod` lives | Local in `Dashboard.tsx` | UI-only; owned entirely by Dashboard; SettingsView receives plain `string` props — no shared import needed |
| Highlight position | No longer floated | Separates concerns: highlighting = attention signal, sorting = ordering preference |
| Sort default | Time (most recent first) | Most useful default for an active monitoring dashboard |
| Sort method cycle | Wraps (not clamped) | Only 3 options — wrapping is faster than hitting a boundary |
| Name sort sensitivity | `{ sensitivity: 'base' }` | Case-insensitive; matches user expectation for directory/project names |
| `settingsCursor` reset on exit | Not reset | Resuming at the same row is better UX |
| `STATUS_RANK` vs `STATUS_ORDER` | Keep both | Different purposes — `STATUS_RANK` is O(1) lookup for sort; `STATUS_ORDER` (WatchView) is iteration array for status counts |

---

## 6. Verification

```bash
npm run build          # must compile cleanly
npm test               # all tests pass including updated U45 and new S1–S26
npm run lint           # no lint errors
npm run dev            # manual smoke test: [t] settings → ↑↓ navigate rows → ◄► change values → esc → verify order in watch and select modes
```
