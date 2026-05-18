# Spec: Persistent Config

## Scope

| File                                  | Change                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/persistence/configStore.ts`      | **New** — `ConfigStore` class: load/save config                                                   |
| `src/persistence/configStore.test.ts` | **New** — unit tests P1–P9                                                                        |
| `src/ui/Dashboard.tsx`                | Add `initialConfig` + `onConfigChange` props; init state from config; save on change              |
| `src/ui/Dashboard.test.tsx`           | Add integration tests P10–P19                                                                     |
| `src/index.ts`                        | Wire `ConfigStore`, pass props to Dashboard, fix `onIntervalChange` → `watcher.setTickInterval()` |

## Dependencies

No new npm packages. Uses Node.js built-ins: `fs`, `os`, `path`.

---

## Background

User settings and session preferences currently live only in React state and are lost on restart. This feature persists them to `~/.ca-dashboard/settings.json` and restores them on next launch.

Also fixed: `onIntervalChange` was already defined in `Dashboard.tsx` and `SessionFileWatcher.setTickInterval()` already existed, but the two were never connected in `index.ts`. This spec wires them.

---

## 1. New File: `src/persistence/configStore.ts`

### DashboardConfig interface

```ts
export interface DashboardConfig {
	watchedIds: string[];
	hiddenIds: string[];
	customNames: Record<string, string>;
	intervalMs: number;
	sortMethod: string; // persisted for forward-compat; populated once multi-sort spec is merged
}
```

### Defaults

```ts
const DEFAULTS: DashboardConfig = {
	watchedIds: [],
	hiddenIds: [],
	customNames: {},
	intervalMs: 1000,
	sortMethod: 'time',
};
```

### ConfigStore class

```ts
export class ConfigStore {
	constructor(private readonly filePath: string) {}

	// Reads and parses the config file; returns defaults on any error.
	load(): DashboardConfig {
		try {
			const raw = fs.readFileSync(this.filePath, 'utf8');
			const parsed = JSON.parse(raw) as Partial<DashboardConfig>;
			return { ...DEFAULTS, ...parsed };
		} catch {
			return { ...DEFAULTS };
		}
	}

	// Atomically writes config: writes to a .tmp file then renames.
	save(config: DashboardConfig): void {
		try {
			const dir = path.dirname(this.filePath);
			fs.mkdirSync(dir, { recursive: true });
			const tmp = this.filePath + '.tmp';
			fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
			fs.renameSync(tmp, this.filePath);
		} catch (err) {
			process.stderr.write(`ca-dashboard: config save failed: ${err}\n`);
		}
	}
}
```

Key behaviors:

- `load()` returns a shallow merge of `DEFAULTS` + parsed file. Unknown fields in the file are discarded; missing fields are filled from defaults.
- `save()` uses atomic write (write `.tmp` → rename) to prevent corruption if the process is killed mid-write.
- `save()` creates `~/.ca-dashboard/` if it does not exist.
- Both methods are synchronous — `load()` runs once at startup before the first render; `save()` is called from a React effect and its latency is not user-visible.

---

## 2. `src/ui/Dashboard.tsx` Changes

### New props

```ts
interface DashboardProps {
	sessions: ResolvedSession[];
	onExit: () => void;
	onIntervalChange?: (ms: number) => void;
	initialConfig?: DashboardConfig; // NEW
	onConfigChange?: (config: DashboardConfig) => void; // NEW
}
```

Import `DashboardConfig` from `'../persistence/configStore.js'`.

### State initialization from initialConfig

Change every persisted state variable to read its initial value from `initialConfig`:

```ts
const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set(initialConfig?.watchedIds ?? []));
const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set(initialConfig?.hiddenIds ?? []));
const [customNames, setCustomNames] = useState<Map<string, string>>(
	new Map(Object.entries(initialConfig?.customNames ?? {})),
);
const [intervalIdx, setIntervalIdx] = useState<number>(() => {
	const idx = PRESETS_MS.indexOf(
		(initialConfig?.intervalMs ?? 1000) as (typeof PRESETS_MS)[number],
	);
	return idx >= 0 ? idx : 1;
});
const [sortMethod, setSortMethod] = useState<SortMethod>(() => {
	const m = initialConfig?.sortMethod;
	return (SORT_METHODS as string[]).includes(m ?? '') ? (m as SortMethod) : SortMethod.Time;
});
```

State variables intentionally NOT persisted (transient UI state):
`mode`, `cursor`, `watchCursor`, `renameBuffer`, `pendingIds`, `highlightedIds`, `settingsCursor`

### Save effect

Add after the highlight detection `useEffect`:

```ts
// Persist user preferences on every change.
useEffect(() => {
	onConfigChange?.({
		watchedIds: [...watchedIds],
		hiddenIds: [...hiddenIds],
		customNames: Object.fromEntries(customNames),
		intervalMs: PRESETS_MS[intervalIdx],
		sortMethod,
	});
}, [watchedIds, hiddenIds, customNames, intervalIdx, sortMethod]); // eslint-disable-line react-hooks/exhaustive-deps
```

`onConfigChange` fires on initial mount as well (writing the loaded values back). This is harmless — the values are identical to what was just read.

---

## 3. `src/index.ts` Changes

Full replacement:

```ts
import os from 'os';
import path from 'path';
import { render } from 'ink';
import React from 'react';
import type { ResolvedSession } from './types.js';
import { SessionFileWatcher } from './watcher/sessionFileWatcher.js';
import { StatusResolver } from './resolver/statusResolver.js';
import { Dashboard } from './ui/Dashboard.js';
import { ConfigStore, type DashboardConfig } from './persistence/configStore.js';

const store = new ConfigStore(path.join(os.homedir(), '.ca-dashboard', 'settings.json'));
const config = store.load();

const watcher = new SessionFileWatcher();
const resolver = new StatusResolver();

let currentSessions: ResolvedSession[] = [];

function makeProps() {
	return {
		sessions: currentSessions,
		initialConfig: config,
		onConfigChange: (c: DashboardConfig) => store.save(c),
		onIntervalChange: (ms: number) => watcher.setTickInterval(ms),
		onExit: () => {
			watcher.stop();
			unmount();
			process.exit(0);
		},
	};
}

const { rerender, unmount } = render(React.createElement(Dashboard, makeProps()));

watcher.start(async (sessionInfos) => {
	currentSessions = await resolver.resolve(sessionInfos);
	rerender(React.createElement(Dashboard, makeProps()));
});
```

Key changes from current `index.ts`:

- `ConfigStore` instantiated and config loaded before first render.
- `initialConfig` passed to Dashboard (seeds initial state; does not change across rerenders).
- `onConfigChange` wired to `store.save()`.
- `onIntervalChange` now wired to `watcher.setTickInterval()` (fixes the pre-existing gap).
- `makeProps()` helper de-duplicates the prop object across initial render and rerenders.

---

## 4. Test Design

### `src/persistence/configStore.test.ts` (new file)

Uses `fs.mkdtempSync` to create a temporary directory per test; cleans up in `afterEach`. Never reads or writes `~/.ca-dashboard`.

| ID  | Description                                      | Setup                                            | Assert                                             |
| --- | ------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------- |
| P1  | Returns defaults when file does not exist        | Point store at non-existent path                 | Returned object equals `DEFAULTS`                  |
| P2  | Returns defaults when file contains invalid JSON | Write `"not json"` to file                       | Returned object equals `DEFAULTS`                  |
| P3  | Returns parsed config for valid file             | Write full valid config JSON                     | Returned object equals that config                 |
| P4  | Fills missing fields with defaults               | Write `{ "intervalMs": 5000 }`                   | Returns merged: intervalMs=5000, rest=defaults     |
| P5  | Ignores unknown fields                           | Write `{ "unknownKey": 42, "intervalMs": 1000 }` | Returned object has no `unknownKey` property       |
| P6  | `save()` writes valid JSON                       | Call `save()`, read file back                    | File parses as JSON matching saved config          |
| P7  | `save()` creates directory if missing            | Point store at path in non-existent sub-dir      | File is created; directory exists                  |
| P8  | `save()` is atomic (no leftover .tmp)            | Call `save()`                                    | No `.tmp` file exists alongside the config         |
| P9  | `save()` does not throw on error                 | Point store at `/nonexistent/readonly/path`      | No exception thrown; `process.stderr.write` called |

### `src/ui/Dashboard.test.tsx` additions (P10–P19)

| ID  | Description                                            | Setup                                                                     | Assert                                                                                           |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P10 | `initialConfig.watchedIds` seeds watch list            | Pass two watched sessionIds in `initialConfig`; matching sessions present | Both sessions visible in watch mode on mount                                                     |
| P11 | `initialConfig.hiddenIds` hides sessions               | Pass one hiddenId; that session present                                   | Hidden session absent from watch mode on mount                                                   |
| P12 | `initialConfig.customNames` shows custom names         | Pass custom name for a session                                            | Watch mode renders the custom name on mount                                                      |
| P13 | `initialConfig.intervalMs` sets interval               | Pass `intervalMs: 5000`                                                   | Settings mode shows "5s" as current interval                                                     |
| P14 | Unknown `intervalMs` falls back to default             | Pass `intervalMs: 9999`                                                   | Settings mode shows "1s" (default idx=1)                                                         |
| P15 | `onConfigChange` fires when watched sessions confirmed | Enter select, toggle session, press Enter                                 | `onConfigChange` called with updated `watchedIds`                                                |
| P16 | `onConfigChange` fires when session hidden             | Press `x` on a session                                                    | `onConfigChange` called with updated `hiddenIds`                                                 |
| P17 | `onConfigChange` fires when interval changes           | Enter settings, press `→`                                                 | `onConfigChange` called with updated `intervalMs`                                                |
| P18 | `onConfigChange` fires when session renamed            | Rename a session                                                          | `onConfigChange` called with updated `customNames`                                               |
| P19 | `onConfigChange` config has correct shape              | Trigger any change                                                        | Object has all five fields: `watchedIds`, `hiddenIds`, `customNames`, `intervalMs`, `sortMethod` |

---

## 5. Key Design Decisions

| Decision                       | Choice                          | Reason                                                                                                             |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Config file path               | `~/.ca-dashboard/settings.json` | User-specified location                                                                                            |
| Sync vs async I/O              | Synchronous                     | `load()` runs once before render (no async context); `save()` is fire-and-forget from a useEffect                  |
| Atomic write                   | `.tmp` + rename                 | Prevents corrupt config if process is killed mid-write                                                             |
| `initialConfig` as prop        | Passed from `index.ts`          | Keeps Dashboard testable — tests can pass any config without touching the filesystem                               |
| `onConfigChange` as prop       | Passed from `index.ts`          | Same testability reason; `index.ts` wires it to `store.save()`                                                     |
| `highlightedIds` not persisted | Intentional                     | Transient: reflects status changes since last view, not a user preference                                          |
| `settingsCursor` not persisted | Intentional                     | Transient UI position state                                                                                        |
| `sortMethod` in schema         | Yes, fully wired                | Multi-sort (`docs/specs/multi-sort.md`) is merged; `sortMethod` is seeded from `initialConfig` and saved on change |
| `onIntervalChange` fix         | Wired in this spec              | Pre-existing gap; natural place to fix since index.ts is already being modified                                    |

---

## 6. Verification

```bash
npm run build          # must compile cleanly
npm test               # P1–P19 pass; all existing tests unaffected
npm run lint           # no lint errors
npm run dev            # manual: change interval → hide a session → rename a session → q → restart → confirm all preferences restored
```
