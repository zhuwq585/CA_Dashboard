import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { SessionStatus } from '../types.js';
import type { ResolvedSession } from '../types.js';
import { formatStatus, formatRelativeTime } from './formatters.js';

const STATUS_W = 12;
const TIME_W = 10;
const PADDING = 2;
// title(1) + scroll-indicator-top(1) + scroll-indicator-bottom(1) + hint(1) + status-counts(1) + padding
const FIXED_ROWS = 6;

const STATUS_ORDER = [
	SessionStatus.Executing,
	SessionStatus.Waiting,
	SessionStatus.Idle,
	SessionStatus.Hanging,
	SessionStatus.Dead,
] as const;

interface WatchViewProps {
	sessions: ResolvedSession[];
	allSessions: ResolvedSession[];
	cursor: number;
	highlightedIds: Set<string>;
	customNames: Map<string, string>;
}

export function WatchView({
	sessions,
	allSessions,
	cursor,
	highlightedIds,
	customNames,
}: WatchViewProps): React.ReactElement {
	const { columns, rows } = useWindowSize();
	const nameWidth = Math.max(8, columns - STATUS_W - TIME_W - PADDING);

	const visibleCount = Math.max(1, rows - FIXED_ROWS);
	const maxOffset = Math.max(0, sessions.length - visibleCount);
	const idealOffset = cursor - Math.floor(visibleCount / 2);
	const scrollOffset = Math.max(0, Math.min(maxOffset, idealOffset));
	const visibleSessions = sessions.slice(scrollOffset, scrollOffset + visibleCount);

	// Status counts across all sessions.
	const counts = new Map<SessionStatus, number>();
	for (const s of allSessions) {
		counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
	}
	const countParts = STATUS_ORDER.filter((st) => counts.has(st)).map(
		(st) => `${counts.get(st)} ${st}`,
	);

	return (
		<Box flexDirection="column">
			{sessions.length === 0 ? (
				<Text>No sessions selected. Press [s] to select.</Text>
			) : (
				<>
					{scrollOffset > 0 && <Text dimColor>{`↑ ${scrollOffset} more`}</Text>}
					{visibleSessions.map((s, i) => {
						const fullIdx = scrollOffset + i;
						const id = s.sessionInfo.sessionId;
						const name = customNames.get(id) ?? s.displayName;
						const isCursor = fullIdx === cursor;
						const isHighlight = highlightedIds.has(id);
						return (
							<Box key={id}>
								<Box width={nameWidth}>
									<Text
										inverse={isCursor}
										bold={isHighlight}
										color={isHighlight ? 'yellow' : undefined}
									>
										{name}
									</Text>
								</Box>
								<Box width={STATUS_W}>
									<Text
										inverse={isCursor}
										bold={isHighlight}
										color={isHighlight ? 'yellow' : undefined}
									>
										{formatStatus(s.status)}
									</Text>
								</Box>
								<Text
									inverse={isCursor}
									bold={isHighlight}
									color={isHighlight ? 'yellow' : undefined}
								>
									{formatRelativeTime(s.lastActiveMs ?? s.sessionInfo.updatedAt)}
								</Text>
							</Box>
						);
					})}
					{scrollOffset + visibleCount < sessions.length && (
						<Text dimColor>{`↓ ${sessions.length - scrollOffset - visibleCount} more`}</Text>
					)}
				</>
			)}
			<Text>[s] select [t] settings [d] dismiss [x] hide [q] quit</Text>
			{countParts.length > 0 && <Text dimColor>{countParts.join(' · ')}</Text>}
		</Box>
	);
}
