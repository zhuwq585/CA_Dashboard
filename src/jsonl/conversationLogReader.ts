import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ConversationState } from '../types.js';

const DEFAULT_TAIL_BYTES = 64 * 1024;

// Encodes a cwd into the JSONL project subdirectory name (every '/' becomes '-').
export function encodeProjectPath(cwd: string): string {
	return cwd.replace(/\//g, '-');
}

export interface ConversationLogReaderOptions {
	jsonlRoot?: string;
	tailBytes?: number;
}

export interface ConversationStateResult {
	state:    ConversationState;
	mtimeMs?: number;
}

interface ParsedEntry {
	type?: string;
	message?: {
		role?: string;
		content?: Array<{ type?: string }>;
		stop_reason?: string;
	};
}

export class ConversationLogReader {
	private readonly jsonlRoot: string;
	private readonly tailBytes: number;

	constructor(options?: ConversationLogReaderOptions) {
		this.jsonlRoot = options?.jsonlRoot ?? path.join(os.homedir(), '.claude', 'projects');
		this.tailBytes = options?.tailBytes ?? DEFAULT_TAIL_BYTES;
	}

	// Reads the JSONL conversation log for a session and classifies its last entry.
	async readState(cwd: string, sessionId: string): Promise<ConversationStateResult> {
		const filePath = path.join(this.jsonlRoot, encodeProjectPath(cwd), `${sessionId}.jsonl`);
		try {
			const stat = await fs.stat(filePath);
			if (stat.size === 0) {
				return { state: { kind: 'unknown' }, mtimeMs: stat.mtimeMs };
			}
			const entries = await this.readTailEntries(filePath, stat.size);
			return { state: classify(entries), mtimeMs: stat.mtimeMs };
		} catch {
			return { state: { kind: 'unknown' } };
		}
	}

	// Reads the tail of the JSONL file and returns successfully parsed entries in order.
	private async readTailEntries(filePath: string, fileSize: number): Promise<ParsedEntry[]> {
		const handle = await fs.open(filePath, 'r');
		try {
			const readSize = Math.min(this.tailBytes, fileSize);
			const offset   = fileSize - readSize;
			const buffer   = Buffer.alloc(readSize);
			await handle.read(buffer, 0, readSize, offset);
			let text = buffer.toString('utf-8');
			// Drop a leading partial line if we did not start at the beginning of the file.
			if (offset > 0) {
				const nl = text.indexOf('\n');
				text = nl === -1 ? '' : text.slice(nl + 1);
			}
			return text
				.split('\n')
				.map(line => line.trim())
				.filter(line => line.length > 0)
				.map(line => {
					try {
						return JSON.parse(line) as ParsedEntry;
					} catch {
						return null;
					}
				})
				.filter((e): e is ParsedEntry => e !== null);
		} finally {
			await handle.close();
		}
	}
}

// Returns true when an assistant entry's content includes a tool_use block.
function hasToolUseBlock(entry: ParsedEntry): boolean {
	return Array.isArray(entry.message?.content)
		&& entry.message!.content!.some(block => block.type === 'tool_use');
}

// Maps the parsed entries (in order) to a ConversationState.
function classify(entries: ParsedEntry[]): ConversationState {
	if (entries.length === 0) return { kind: 'unknown' };

	// Find the last user entry index to determine whether a pending tool_use is still pending.
	let lastUserIdx = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === 'user') { lastUserIdx = i; break; }
	}

	// Find the last assistant entry whose stop_reason was tool_use AND that included a tool_use block.
	let lastPendingToolIdx = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === 'assistant' && e.message?.stop_reason === 'tool_use' && hasToolUseBlock(e)) {
			lastPendingToolIdx = i;
			break;
		}
	}

	if (lastPendingToolIdx > lastUserIdx) {
		return { kind: 'pendingToolApproval' };
	}

	const last = entries[entries.length - 1];
	if (last.type === 'assistant') return { kind: 'assistantDone' };
	if (last.type === 'user') return { kind: 'userTurn' };
	return { kind: 'unknown' };
}
