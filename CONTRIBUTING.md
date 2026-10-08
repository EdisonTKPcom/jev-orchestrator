# Contributing

Issues and pull requests are welcome.

```bash
npm install
npm test
npm run typecheck
npm run demo
```

- The happy path stays offline. `claim`, `handoff`, and `demo` must not gain a network call.
- Runtime dependencies stay at zero unless the standard library cannot do the job.
- A change to the board format updates `docs/protocol.md` and the tests together.
- Adapter filenames follow the current docs for that tool: `AGENTS.md`, a `CLAUDE.md` that imports it with `@AGENTS.md`, `.cursor/rules/*.mdc` with `alwaysApply`, and `.devin/rules/*.md` with `trigger: always_on`. Do not invent a Codex config key for the board.
- Do not commit `.env` files, tokens, or claim logs from a real project. `.jev/` is gitignored in this repo.

The design notes are in `docs/design.md`.
