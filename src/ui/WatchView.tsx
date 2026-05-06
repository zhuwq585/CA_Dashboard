import React from 'react';
import { Box, Text } from 'ink';
import type { ResolvedSession } from '../types.js';
import { formatStatus, formatRelativeTime } from './formatters.js';

interface WatchViewProps {
	sessions: ResolvedSession[];
}

export function WatchView({ sessions }: WatchViewProps): React.ReactElement {
	return (
		<Box flexDirection="column">
			{sessions.length === 0 ? (
				<Text>No sessions selected. Press [s] to select.</Text>
			) : (
				sessions.map(s => (
					<Box key={s.sessionInfo.sessionId}>
						<Box width={24}><Text>{s.displayName}</Text></Box>
						<Box width={16}><Text>{formatStatus(s.status)}</Text></Box>
						<Text>{formatRelativeTime(s.sessionInfo.updatedAt)}</Text>
					</Box>
				))
			)}
			<Text>[s] select sessions   [q] quit</Text>
		</Box>
	);
}
