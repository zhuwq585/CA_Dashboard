import React from 'react';
import type { ResolvedSession } from '../types.js';

interface SelectViewProps {
	sessions: ResolvedSession[];
	checkedIds: Set<string>;
	cursor: number;
	onCursorMove: (delta: -1 | 1) => void;
	onToggle: () => void;
	onConfirm: () => void;
	onCancel: () => void;
}

export function SelectView(_props: SelectViewProps): React.ReactElement {
	return React.createElement(React.Fragment, null);
}
