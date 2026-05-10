import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import type { ResolvedSession } from '../types.js';
import { formatStatus } from './formatters.js';

const STATUS_W = 12;
const TIME_W   = 10;
const PADDING  = 4; // checkbox prefix

interface SelectViewProps {
	sessions:    ResolvedSession[];
	checkedIds:  Set<string>;
	cursor:      number;
	customNames: Map<string, string>;
	isRenaming:  boolean;
	renameValue: string;
	onCursorMove: (delta: -1 | 1) => void;
	onToggle: () => void;
	onConfirm: () => void;
	onCancel: () => void;
}

export function SelectView({ sessions, checkedIds, cursor, customNames, isRenaming, renameValue }: SelectViewProps): React.ReactElement {
	const { columns } = useWindowSize();
	const nameWidth = Math.max(8, columns - STATUS_W - TIME_W - PADDING);

	return (
		<Box flexDirection="column">
			<Text>Select sessions to watch:</Text>
			{sessions.map((s, i) => {
				const id        = s.sessionInfo.sessionId;
				const isCursor  = i === cursor;
				const isChecked = checkedIds.has(id);
				const checkbox  = isCursor ? '[►]' : isChecked ? '[✓]' : '[ ]';
				const name      = customNames.get(id) ?? s.displayName;

				const nameCell = isRenaming && isCursor
					? `[${renameValue}_]`
					: name;

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
			{isRenaming
				? <Text>enter confirm   esc cancel</Text>
				: <Text>↑↓ navigate   space toggle   r rename   enter confirm   esc cancel</Text>
			}
		</Box>
	);
}
