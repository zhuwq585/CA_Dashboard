#!/usr/bin/env node
// Diagnostic for users (especially Linux) reporting status misclassification.
// Run while a Claude Code session is actively asking for approval, then send
// the output. Reports per-session: session.json contents, JSONL classification,
// direct child processes, and what the resolver decides.
//
// Usage:
//   node scripts/diagnose.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { x } from 'tinyexec';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const { ConversationLogReader } = await import(
	path.join(ROOT, '..', 'dist', 'jsonl', 'conversationLogReader.js')
);
const { StatusResolver } = await import(
	path.join(ROOT, '..', 'dist', 'resolver', 'statusResolver.js')
);

const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
const files = (await fs.readdir(sessionsDir)).filter((f) => f.endsWith('.json'));
const sessions = await Promise.all(
	files.map(async (f) => JSON.parse(await fs.readFile(path.join(sessionsDir, f), 'utf-8'))),
);

const reader = new ConversationLogReader();
const resolved = await new StatusResolver().resolve(sessions);

console.log(`Platform: ${os.platform()} ${os.release()}`);
console.log(`Node:     ${process.version}\n`);

for (const r of resolved) {
	const s = r.sessionInfo;
	const log = await reader.readState(s.cwd, s.sessionId);
	let children = '<unavailable>';
	try {
		const out = await x('pgrep', ['-P', String(s.pid), '-l']);
		children = out.stdout.trim() || '<none>';
	} catch {
		children = '<no children>';
	}
	console.log('─'.repeat(72));
	console.log(`pid=${s.pid}  cwd=${s.cwd}`);
	console.log(
		`session.json: status=${s.status ?? '<none>'}  waitingFor=${s.waitingFor ?? '<none>'}  updatedAt=${s.updatedAt ?? '<none>'}`,
	);
	console.log(`JSONL state:  ${log.state.kind}  mtime=${log.mtimeMs ?? '<none>'}`);
	console.log(`pgrep -P ${s.pid} -l:`);
	for (const line of String(children).split('\n')) console.log('  ' + line);
	console.log(`Resolver verdict: ${r.status}`);
}
