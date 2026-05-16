import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigStore } from './configStore.js';
import type { DashboardConfig } from './configStore.js';

const DEFAULTS: DashboardConfig = {
	watchedIds:  [],
	hiddenIds:   [],
	customNames: {},
	intervalMs:  1000,
	sortMethod:  'time',
};

let tmpDir: string;

afterEach(() => {
	if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTmpDir(): string {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-dashboard-test-'));
	return tmpDir;
}

describe('ConfigStore.load', () => {
	it('P1: returns defaults when file does not exist', () => {
		const dir   = makeTmpDir();
		const store = new ConfigStore(path.join(dir, 'nonexistent', 'settings.json'));
		expect(store.load()).toEqual(DEFAULTS);
	});

	it('P2: returns defaults when file contains invalid JSON', () => {
		const dir  = makeTmpDir();
		const file = path.join(dir, 'settings.json');
		fs.writeFileSync(file, 'not json', 'utf8');
		const store = new ConfigStore(file);
		expect(store.load()).toEqual(DEFAULTS);
	});

	it('P3: returns parsed config for valid file', () => {
		const dir    = makeTmpDir();
		const file   = path.join(dir, 'settings.json');
		const config: DashboardConfig = {
			watchedIds:  ['id-1', 'id-2'],
			hiddenIds:   ['id-3'],
			customNames: { 'id-1': 'My Session' },
			intervalMs:  5000,
			sortMethod:  'status',
		};
		fs.writeFileSync(file, JSON.stringify(config), 'utf8');
		const store = new ConfigStore(file);
		expect(store.load()).toEqual(config);
	});

	it('P4: fills missing fields with defaults', () => {
		const dir  = makeTmpDir();
		const file = path.join(dir, 'settings.json');
		fs.writeFileSync(file, JSON.stringify({ intervalMs: 5000 }), 'utf8');
		const store = new ConfigStore(file);
		expect(store.load()).toEqual({ ...DEFAULTS, intervalMs: 5000 });
	});

	it('P5: ignores unknown fields', () => {
		const dir  = makeTmpDir();
		const file = path.join(dir, 'settings.json');
		fs.writeFileSync(file, JSON.stringify({ unknownKey: 42, intervalMs: 1000 }), 'utf8');
		const store = new ConfigStore(file);
		const result = store.load();
		expect(result).not.toHaveProperty('unknownKey');
		expect(result.intervalMs).toBe(1000);
	});
});

describe('ConfigStore.save', () => {
	it('P6: writes valid JSON matching the saved config', () => {
		const dir    = makeTmpDir();
		const file   = path.join(dir, 'settings.json');
		const config: DashboardConfig = { ...DEFAULTS, intervalMs: 2000 };
		const store  = new ConfigStore(file);
		store.save(config);
		const written = JSON.parse(fs.readFileSync(file, 'utf8'));
		expect(written).toEqual(config);
	});

	it('P7: creates directory if missing', () => {
		const dir   = makeTmpDir();
		const file  = path.join(dir, 'sub', 'dir', 'settings.json');
		const store = new ConfigStore(file);
		store.save({ ...DEFAULTS });
		expect(fs.existsSync(file)).toBe(true);
	});

	it('P8: leaves no .tmp file after save', () => {
		const dir  = makeTmpDir();
		const file = path.join(dir, 'settings.json');
		const store = new ConfigStore(file);
		store.save({ ...DEFAULTS });
		expect(fs.existsSync(file + '.tmp')).toBe(false);
	});

	it('P9: does not throw on unwritable path; writes to stderr', () => {
		const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		const store = new ConfigStore('/nonexistent/readonly/path/settings.json');
		expect(() => store.save({ ...DEFAULTS })).not.toThrow();
		expect(stderrSpy).toHaveBeenCalled();
		stderrSpy.mockRestore();
	});
});
