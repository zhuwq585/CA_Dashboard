import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConversationLogReader, encodeProjectPath } from './conversationLogReader.js';

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CWD = '/sample/cwd';

let tmpDir: string;
let reader: ConversationLogReader;

// Builds the JSONL path the reader will look for, and ensures the dir exists.
async function jsonlPath(): Promise<string> {
	const subdir = path.join(tmpDir, encodeProjectPath(CWD));
	await fs.mkdir(subdir, { recursive: true });
	return path.join(subdir, `${SESSION_ID}.jsonl`);
}

// Writes a sequence of JSONL entries to the session's log file.
async function writeJsonl(entries: unknown[]): Promise<string> {
	const file = await jsonlPath();
	const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
	await fs.writeFile(file, content);
	return file;
}

const assistantToolUse = {
	type: 'assistant',
	uuid: 'asst-tool',
	timestamp: '2026-05-08T03:16:53.778Z',
	message: {
		role: 'assistant',
		content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }],
		stop_reason: 'tool_use',
	},
};

const assistantEndTurn = {
	type: 'assistant',
	uuid: 'asst-end',
	timestamp: '2026-05-08T03:17:00.000Z',
	message: {
		role: 'assistant',
		content: [{ type: 'text', text: 'done' }],
		stop_reason: 'end_turn',
	},
};

const userMessage = {
	type: 'user',
	uuid: 'user-1',
	timestamp: '2026-05-08T03:18:00.000Z',
	message: {
		role: 'user',
		content: [{ type: 'text', text: 'hello' }],
	},
};

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ca-dash-jsonl-'));
	reader = new ConversationLogReader({ jsonlRoot: tmpDir });
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('encodeProjectPath', () => {
	it('C1: replaces every / with -', () => {
		expect(encodeProjectPath('/Users/x/y')).toBe('-Users-x-y');
	});

	it('C2: encodes root /', () => {
		expect(encodeProjectPath('/')).toBe('-');
	});

	it('C2a: replaces underscores with - (matches real Claude Code encoding)', () => {
		// Empirically observed: Claude Code stores this cwd at
		// ~/.claude/projects/-Users-syu-workspace-CA-Dashboard/
		expect(encodeProjectPath('/Users/syu/workspace/CA_Dashboard')).toBe(
			'-Users-syu-workspace-CA-Dashboard',
		);
	});

	it('C2b: replaces dots and other non-alphanumerics with -', () => {
		expect(encodeProjectPath('/foo.bar/baz qux')).toBe('-foo-bar-baz-qux');
	});
});

describe('ConversationLogReader.readState', () => {
	it('C3: pendingToolApproval when last line is assistant tool_use', async () => {
		await writeJsonl([assistantEndTurn, userMessage, assistantToolUse]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('pendingToolApproval');
	});

	it('C4: assistantDone when last line is assistant end_turn', async () => {
		await writeJsonl([userMessage, assistantEndTurn]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('assistantDone');
	});

	it('C5: userTurn when last line is a user message', async () => {
		await writeJsonl([assistantEndTurn, userMessage]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('userTurn');
	});

	it('C6: unknown when JSONL file does not exist', async () => {
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('unknown');
		expect(result.mtimeMs).toBeUndefined();
	});

	it('C7: unknown when file is empty', async () => {
		const file = await jsonlPath();
		await fs.writeFile(file, '');
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('unknown');
		expect(result.mtimeMs).toBeDefined();
	});

	it('C8: skips trailing partial line and reads previous full line', async () => {
		const file = await jsonlPath();
		const goodLine = JSON.stringify(assistantEndTurn) + '\n';
		const partialLine = '{"type":"user","message":{"role":"user","con';
		await fs.writeFile(file, goodLine + partialLine);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('assistantDone');
	});

	it('C9: pendingToolApproval when assistant tool_use is followed only by other assistant entries', async () => {
		const followupAssistant = {
			...assistantEndTurn,
			uuid: 'asst-followup',
			message: {
				...assistantEndTurn.message,
				stop_reason: 'tool_use',
				content: [{ type: 'thinking', thinking: '...' }],
			},
		};
		await writeJsonl([assistantToolUse, followupAssistant]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('pendingToolApproval');
	});

	it('C10: returns mtimeMs from fs.stat', async () => {
		const file = await writeJsonl([assistantEndTurn]);
		const stat = await fs.stat(file);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.mtimeMs).toBeDefined();
		expect(Math.abs((result.mtimeMs ?? 0) - stat.mtimeMs)).toBeLessThan(5);
	});

	it('C11: userTurn when tool_use is followed by a user message (tool_result returned)', async () => {
		await writeJsonl([assistantToolUse, userMessage]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('userTurn');
	});

	const attachment = {
		type: 'attachment',
		uuid: 'att-1',
		timestamp: '2026-05-08T03:19:00.000Z',
	};

	it('C13: synthetic entries (attachment) after a user turn → still userTurn', async () => {
		await writeJsonl([assistantEndTurn, userMessage, attachment]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('userTurn');
	});

	it('C14: synthetic entries after an assistant end_turn → still assistantDone', async () => {
		await writeJsonl([userMessage, assistantEndTurn, attachment]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('assistantDone');
	});

	it('C15: synthetic entries after a pending tool_use → still pendingToolApproval', async () => {
		await writeJsonl([assistantToolUse, attachment]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('pendingToolApproval');
	});

	it('C16: only synthetic entries → unknown', async () => {
		await writeJsonl([attachment, { ...attachment, uuid: 'att-2', type: 'pr-link' }]);
		const result = await reader.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('unknown');
	});

	it('C12: classifies correctly when file exceeds tailBytes', async () => {
		// Each filler entry is ~100 bytes; 200 entries puts the file well over 1 KB.
		const filler = Array.from({ length: 200 }, (_, i) => ({
			...assistantEndTurn,
			uuid: `filler-${i}`,
		}));
		await writeJsonl([...filler, assistantToolUse]);

		const reader1k = new ConversationLogReader({ jsonlRoot: tmpDir, tailBytes: 1024 });
		const result = await reader1k.readState(CWD, SESSION_ID);
		expect(result.state.kind).toBe('pendingToolApproval');

		// With a tailBytes smaller than any single entry, every parse fails → unknown.
		const reader30 = new ConversationLogReader({ jsonlRoot: tmpDir, tailBytes: 30 });
		const tiny = await reader30.readState(CWD, SESSION_ID);
		expect(tiny.state.kind).toBe('unknown');
	});
});
