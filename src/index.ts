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
