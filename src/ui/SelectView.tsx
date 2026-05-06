import React from 'react';
import { Box, Text } from 'ink';
import type { ResolvedSession } from '../types.js';
import { formatStatus } from './formatters.js';

interface SelectViewProps {
	sessions: ResolvedSession[];
	checkedIds: Set<string>;
	cursor: number;
	onCursorMove: (delta: -1 | 1) => void;
	onToggle: () => void;
	onConfirm: () => void;
	onCancel: () => void;
}

export function SelectView({ sessions, checkedIds, cursor }: SelectViewProps): React.ReactElement {
	return (
		<Box flexDirection="column">
			<Text>Select sessions to watch:</Text>
			{sessions.map((s, i) => {
				const id = s.sessionInfo.sessionId;
				const isCursor = i === cursor;
				const isChecked = checkedIds.has(id);
				const checkbox = isCursor ? '[►]' : isChecked ? '[✓]' : '[ ]';
				return (
					<Box key={id}>
						<Text>{`  ${checkbox} `}</Text>
						<Box width={24}><Text>{s.displayName}</Text></Box>
						<Text>{formatStatus(s.status)}</Text>
					</Box>
				);
			})}
			<Text>↑↓ navigate   space toggle   enter confirm   esc cancel</Text>
		</Box>
	);
}
