import React from 'react';
import { Box, Text } from 'ink';

interface SettingsViewProps {
	intervalMs: number;
	presets: readonly number[];
	labels: readonly string[];
}

export function SettingsView({
	intervalMs,
	presets,
	labels,
}: SettingsViewProps): React.ReactElement {
	const idx = presets.indexOf(intervalMs);
	const label = idx >= 0 ? labels[idx] : `${intervalMs}ms`;
	return (
		<Box flexDirection="column">
			<Text>Settings</Text>
			<Text> </Text>
			<Text> Poll interval: [◄] {label} [►]</Text>
			<Text> </Text>
			<Text>◄► change interval esc back</Text>
		</Box>
	);
}
