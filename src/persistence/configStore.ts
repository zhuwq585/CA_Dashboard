import fs from 'fs';
import path from 'path';

export interface DashboardConfig {
	watchedIds: string[];
	hiddenIds: string[];
	customNames: Record<string, string>;
	intervalMs: number;
	sortMethod: string;
}

const DEFAULTS: DashboardConfig = {
	watchedIds: [],
	hiddenIds: [],
	customNames: {},
	intervalMs: 1000,
	sortMethod: 'time',
};

export class ConfigStore {
	constructor(private readonly filePath: string) {}

	// Reads and parses the config file; returns defaults on any error.
	load(): DashboardConfig {
		try {
			const raw = fs.readFileSync(this.filePath, 'utf8');
			const parsed = JSON.parse(raw) as Partial<DashboardConfig>;
			const merged: DashboardConfig = { ...DEFAULTS };
			if (Array.isArray(parsed.watchedIds)) merged.watchedIds = parsed.watchedIds;
			if (Array.isArray(parsed.hiddenIds)) merged.hiddenIds = parsed.hiddenIds;
			if (
				parsed.customNames &&
				typeof parsed.customNames === 'object' &&
				!Array.isArray(parsed.customNames)
			)
				merged.customNames = parsed.customNames as Record<string, string>;
			if (typeof parsed.intervalMs === 'number') merged.intervalMs = parsed.intervalMs;
			if (typeof parsed.sortMethod === 'string') merged.sortMethod = parsed.sortMethod;
			return merged;
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
