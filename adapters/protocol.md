## Shared board (jev-orchestrator)

This repository keeps a local board so coding agents take turns on a task.
The board is the `.jev/` directory. There is no account and no token.

Agent ids: `cursor`, `claude-code`, `codex`, `devin`, `generic`.
Codex reads this `AGENTS.md` file. There is no Codex config key for the board.

Before you edit files that belong to a task:

1. Run `jev-orchestrator list`.
2. Run `jev-orchestrator check --path <file>` for each file you will touch.
3. Run `jev-orchestrator claim <id> --agent <your-id>`.
4. If the claim is refused, stop. Run `jev-orchestrator context <id>` and work on something else.
5. While you still hold the task, renew a long session with `jev-orchestrator heartbeat <id> --agent <your-id>`.
6. When you stop, hand off or finish:
   - `jev-orchestrator handoff <id> --agent <your-id> --to <next-id> --done "what you did" --next "what they should do"`
   - `jev-orchestrator done <id> --agent <your-id> --note "what you finished"`

A claim lasts 30 minutes unless `--ttl` says otherwise (10s to 24h). After it expires, another agent may take the task.
Claiming a task locks its paths. A second claim whose path is that file, or a parent or child directory, is refused while the lease is active.
A task with no paths locks no files.

Write handoffs in plain language: what changed, what is next, and what the next agent should leave alone.
Keep API keys, tokens, passwords, and `.env` contents out of titles, notes, and handoffs.
The lock is this machine's filesystem. Another clone does not see your claim until the task file is shared, and even then v1 has no cross-machine lock.
