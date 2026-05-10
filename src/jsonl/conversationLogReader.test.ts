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
	const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
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
			message: { ...assistantEndTurn.message, stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '...' }] },
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
});
