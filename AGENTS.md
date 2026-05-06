# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

CA_Dashboard monitors multiple coding agent sessions (Claude Code, CodeX, etc.) running simultaneously on local or remote machines (SSH + tmux). It surfaces per-session state — executing, waiting for user input, idle/finished, or hanging — in a single unified view.

## Session States

The four states the dashboard must distinguish:

| State | Meaning |
|---|---|
| **Executing** | Agent is actively running a task |
| **Waiting** | Agent is paused, expecting user input |
| **Idle** | Agent finished its last task, no new work |
| **Hanging** | Session is unresponsive or stalled |

## Commands

```bash
npm run build          # compile TypeScript → dist/
npm run dev            # run via tsx (no compile step)
npm test               # run tests once
npm run test:watch     # re-run tests on change
npm run test:coverage  # run tests with coverage report
npm run lint           # ESLint
```

## Tech Stack

- **Language**: TypeScript (Node.js, ESM modules)
- **Test runner**: Vitest — test files live alongside source files (`*.test.ts`)
- **Linter**: ESLint with `@typescript-eslint`
- **Code style**: camelCase for variables/functions, PascalCase for types/classes/interfaces; tabs for indentation

## Development Process

This project follows **spec-driven TDD** using a **two-agent pattern**:

### Two-Agent Pattern

Two distinct agent roles operate in this repo. Each agent must know which role it is playing before acting.

**Main-branch agent** — runs on `main`, never writes implementation code:
1. Write the spec document for a feature in `docs/specs/<feature-name>.md`
2. Create a `feature/` branch and a git worktree for it
3. Open a draft PR for the branch
4. Hand off to a feature-branch agent by pointing it at the worktree and spec

**Feature-branch agent** — runs inside the feature worktree, never touches `main`:
1. Read the spec document produced by the main-branch agent
2. Follow the Red-Green-Refactor cycle: write failing tests → implement → clean up
3. Push commits to the feature branch
4. Mark the PR ready for review when all tests pass

### Spec-Driven TDD Cycle

1. **Design** — architecture decisions are captured in `docs/architecture.md` before any feature work
2. **Spec** — main-branch agent writes `docs/specs/<feature>.md` before any implementation begins
3. **Red** — create stub source files, then write failing tests
4. **Green** — fill in logic until all tests pass
5. **Refactor** — clean up; all tests must still pass

Never write implementation code without a spec. Never write a spec without reading `docs/architecture.md` first.

### Red phase rules

Before writing any tests, create every source file the spec calls for. Each file must:
- Export all types, interfaces, enums, and class/function signatures exactly as the spec defines
- Have empty or minimal bodies — functions return `undefined`, class methods throw `new Error('not implemented')`, enums and interfaces are complete
- Compile without TypeScript errors (`npm run build` passes)

Tests must fail in the red phase because the **logic is missing**, not because a file or export does not exist. An import error or type error is not a valid red state — fix it before writing tests.

## Naming Rules

Branch names must start with one of the following prefixes:

| Prefix | Purpose |
|---|---|
| `design/` | Architecture and system design work |
| `feature/` | New feature implementation |
| `fix/` | Bug fixes |
| `dev/` | Tooling, configuration, and developer experience |

Example: `feature/session-status-polling`, `fix/hanging-detection-timeout`

## Documents

- [Architecture](docs/architecture.md) — system design, component decisions, transport and UI layer choices
- [Specs](docs/specs/) — per-feature spec documents; each feature must have one before implementation begins
