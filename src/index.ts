import { render } from 'ink';
import React from 'react';
import type { ResolvedSession } from './types.js';
import { SessionFileWatcher } from './watcher/sessionFileWatcher.js';
import { StatusResolver } from './resolver/statusResolver.js';
import { Dashboard } from './ui/Dashboard.js';

const watcher = new SessionFileWatcher();
const resolver = new StatusResolver();

let currentSessions: ResolvedSession[] = [];

const { rerender, unmount } = render(
	React.createElement(Dashboard, {
		sessions: currentSessions,
		onExit: () => {
			watcher.stop();
			unmount();
			process.exit(0);
		},
	}),
);

watcher.start(async (sessionInfos) => {
	currentSessions = await resolver.resolve(sessionInfos);
	rerender(
		React.createElement(Dashboard, {
			sessions: currentSessions,
			onExit: () => {
				watcher.stop();
				unmount();
				process.exit(0);
			},
		}),
	);
});
