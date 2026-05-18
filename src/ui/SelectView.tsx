import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import type { ResolvedSession } from '../types.js';
import { formatStatus } from './formatters.js';

const STATUS_W = 12;
const TIME_W = 10;
const PADDING = 4; // checkbox prefix
// title(1) + header(1) + scroll-top(1) + scroll-bottom(1) + hint(1)
const FIXED_ROWS = 5;

interface SelectViewProps {
	sessions: ResolvedSession[];
	checkedIds: Set<string>;
	cursor: number;
	customNames: Map<string, string>;
	isRenaming: boolean;
	renameValue: string;
	hiddenIds: Set<string>;
}

export function SelectView({
	sessions,
	checkedIds,
	cursor,
	customNames,
	isRenaming,
	renameValue,
	hiddenIds,
}: SelectViewProps): React.ReactElement {
	const { columns, rows } = useWindowSize();
	const nameWidth = Math.max(8, columns - STATUS_W - TIME_W - PADDING);

	const visibleCount = Math.max(1, rows - FIXED_ROWS);
	const maxOffset = Math.max(0, sessions.length - visibleCount);
	const idealOffset = cursor - Math.floor(visibleCount / 2);
	const scrollOffset = Math.max(0, Math.min(maxOffset, idealOffset));
	const visibleSessions = sessions.slice(scrollOffset, scrollOffset + visibleCount);

	return (
		<Box flexDirection="column">
			<Text>Select sessions to watch:</Text>
			{scrollOffset > 0 && <Text dimColor>{`↑ ${scrollOffset} more`}</Text>}
			{visibleSessions.map((s, i) => {
				const fullIdx = scrollOffset + i;
				const id = s.sessionInfo.sessionId;
				const isCursor = fullIdx === cursor;
				const isChecked = checkedIds.has(id);
				const isHidden = hiddenIds.has(id);
				const checkbox = isCursor ? '[►]' : isHidden ? '[~]' : isChecked ? '[✓]' : '[ ]';
				const name = customNames.get(id) ?? s.displayName;

				const nameCell = isRenaming && isCursor ? `[${renameValue}_]` : name;

				return (
					<Box key={id}>
						<Text>{`  ${checkbox} `}</Text>
						<Box width={nameWidth}>
							<Text>{nameCell}</Text>
						</Box>
						<Text>{formatStatus(s.status)}</Text>
					</Box>
				);
			})}
			{scrollOffset + visibleCount < sessions.length && (
				<Text dimColor>{`↓ ${sessions.length - scrollOffset - visibleCount} more`}</Text>
			)}
			{isRenaming ? (
				<Text>enter confirm esc cancel</Text>
			) : (
				<Text>↑↓ navigate space toggle r rename enter confirm esc cancel</Text>
			)}
		</Box>
	);
}
