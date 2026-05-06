import React from 'react';
import type { ResolvedSession } from '../types.js';

interface DashboardProps {
	sessions: ResolvedSession[];
	onExit: () => void;
}

export function Dashboard(_props: DashboardProps): React.ReactElement {
	return React.createElement(React.Fragment, null);
}
