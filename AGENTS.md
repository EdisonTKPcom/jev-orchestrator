# AGENTS.md

jev-orchestrator is a local board and CLI. Protocol v1 is `docs/protocol.md`. The design notes are `docs/design.md`.

## Commands

- Install: `npm install`
- Test: `npm test`
- Types: `npm run typecheck`
- Demo: `npm run demo`
- Build: `npm run build`

## Rules

- The happy path stays offline. `claim`, `handoff`, and `demo` do not make network calls.
- Keep API keys, tokens, and `.env` files out of the repo.
- Runtime dependencies stay at zero unless Node's standard library cannot do the job.
- A public behaviour change updates `docs/protocol.md` and the tests together.
- Adapter filenames must match the tool's docs: `AGENTS.md`, `CLAUDE.md` with an `@AGENTS.md` import, `.cursor/rules/*.mdc`, `.devin/rules/*.md`. Do not invent Codex config keys.
- This file is for people building the CLI. The text `init` writes into other repos lives in `adapters/protocol.md`.
