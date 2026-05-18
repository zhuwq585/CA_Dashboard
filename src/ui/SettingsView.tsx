import React from 'react';
import { Box, Text } from 'ink';

interface SettingsViewProps {
	intervalMs: number;
	presets: readonly number[];
	labels: readonly string[];
	sortMethod: string;
	sortLabels: Record<string, string>;
	settingsCursor: number;
}

export function SettingsView({
	intervalMs,
	presets,
	labels,
	sortMethod,
	sortLabels,
	settingsCursor,
}: SettingsViewProps): React.ReactElement {
	const intervalIdx = presets.indexOf(intervalMs);
	const intervalLabel = intervalIdx >= 0 ? labels[intervalIdx] : `${intervalMs}ms`;
	const sortLabel = sortLabels[sortMethod] ?? sortMethod;
	const prefix = (row: number) => (settingsCursor === row ? '► ' : '  ');

	return (
		<Box flexDirection="column">
			<Text>Settings</Text>
			<Text> </Text>
			<Text>
				{prefix(0)}Poll interval: [◄] {intervalLabel} [►]
			</Text>
			<Text>
				{prefix(1)}Sort method: [◄] {sortLabel} [►]
			</Text>
			<Text> </Text>
			<Text>↑↓ select ◄► change esc back</Text>
		</Box>
	);
}
