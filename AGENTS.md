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

This project follows **spec-driven TDD**:

1. **Design** — establish system architecture before writing any feature code
2. **Spec** — for each feature, write a detailed spec document in `docs/specs/` before implementation begins
3. **Red-Green-Refactor** — write failing unit tests first, then implement the minimum code to make them pass, then clean up

Never write implementation code for a feature without a spec document and failing tests already in place.

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
