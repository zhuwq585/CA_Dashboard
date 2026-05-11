import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import type { ResolvedSession } from '../types.js';
import { formatStatus, formatRelativeTime } from './formatters.js';

const STATUS_W = 12;
const TIME_W   = 10;
const PADDING  = 2;

interface WatchViewProps {
	sessions:       ResolvedSession[];
	cursor:         number;
	highlightedIds: Set<string>;
	customNames:    Map<string, string>;
}

export function WatchView({ sessions, cursor, highlightedIds, customNames }: WatchViewProps): React.ReactElement {
	const { columns } = useWindowSize();
	const nameWidth = Math.max(8, columns - STATUS_W - TIME_W - PADDING);

	return (
		<Box flexDirection="column">
			{sessions.length === 0 ? (
				<Text>No sessions selected. Press [s] to select.</Text>
			) : (
				sessions.map((s, i) => {
					const id          = s.sessionInfo.sessionId;
					const name        = customNames.get(id) ?? s.displayName;
					const isCursor    = i === cursor;
					const isHighlight = highlightedIds.has(id);
					return (
						<Box key={id}>
							<Box width={nameWidth}>
								<Text inverse={isCursor} bold={isHighlight} color={isHighlight ? 'yellow' : undefined}>
									{name}
								</Text>
							</Box>
							<Box width={STATUS_W}>
								<Text inverse={isCursor} bold={isHighlight} color={isHighlight ? 'yellow' : undefined}>
									{formatStatus(s.status)}
								</Text>
							</Box>
							<Text inverse={isCursor} bold={isHighlight} color={isHighlight ? 'yellow' : undefined}>
								{formatRelativeTime(s.lastActiveMs ?? s.sessionInfo.updatedAt)}
							</Text>
						</Box>
					);
				})
			)}
			<Text>[s] select   [t] settings   [d] dismiss   [q] quit</Text>
		</Box>
	);
}
