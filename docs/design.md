# Design

jev-orchestrator is the coordination layer for coding agents that share a checkout. jev-model-router is a different product: it picks a model for one prompt. This repo picks which agent is allowed to touch a task. They share a rule and nothing else.

> Code owns the workflow. The agent writes the code. A model router, if you have one, only leaves a hint.

## Approaches

1. **Hosted queue with accounts.** Works across laptops and cloud agents. It also means a signup before the first claim, and a token in every adapter. Rejected for v1.
2. **Git as the lock.** Commit the task file and hope the push wins. Git will tell you about a conflict after both agents have already edited the source. Rejected as the primary lock.
3. **A directory in the repo, with an exclusive file lock.** Cursor, Claude Code, and Codex on one machine can see it immediately. No account. This is v1.

Cloud agents such as Devin see the board when the checkout they are given contains `.jev/tasks.json` and the handoff files. They do not share the lock with a laptop. That limit is documented in the README and in `docs/protocol.md`.

## Decision map

| Decision | Owner | Why |
| --- | --- | --- |
| Who holds the task right now | Code, via the claim | It is a lease on a file, not a judgement |
| Do two paths overlap | Code | Prefix match is exact |
| Has the lease expired | Code | Clock arithmetic |
| Does this text look like a token | Code | Pattern check before the write |
| Which model should answer a prompt | jev-model-router, optional | Typed model choice stays in that package. Store the result as `modelHint` if the caller has one |
| What the next agent should do | The agent writing the handoff | That is language |
| Editing the repository | The agent that holds the claim | That is the work |

v1 does not ask TypeSafe which agent should take a task. Idle-ness and file locks are facts the process already has. A future classifier would be an optional hint, never a second lock.

## Pieces

| Piece | Role |
| --- | --- |
| `src/board.ts` | State machine: add, claim, heartbeat, block, handoff, release, done |
| `src/lock.ts` | Same-machine mutex (`board.lock`, exclusive create, nonce on release) |
| `src/paths.ts` | Path lock rules |
| `src/secrets.ts` | Reject token-shaped text |
| `src/render.ts` | Handoff markdown and the context packet |
| `src/adapters.ts` | Writes `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, `.devin/rules/*.md` |
| `src/cli.ts` | The binary |
| `src/model-hint.ts` | Records a model choice made elsewhere |

## v1 behaviour

- Task states: `open`, `claimed`, `blocked`, `done`.
- Lock identity is agent id plus holder string. Default holder is `user@hostname`.
- Default lease is 30 minutes, bounded to 10 seconds through 24 hours.
- The same agent and holder may renew. Anyone else waits until expiry, or until a force-release.
- Handoff sets the task back to `open`, records a preferred next agent, and writes Markdown under `.jev/handoffs/`.
- Overlapping paths on two active claims are refused. A task with no paths locks nothing.
- `tasks.json` is rewritten with a temp file and rename while the lock is held.

## Tests

The tests cover exclusive claim, path overlap, lease expiry, handoff contents, secret rejection, force-release, parallel claims, protocol mismatch, adapter filenames, and the demo. `npm run demo` fails if a claim that should be refused is accepted.

## Out of scope

A multi-host lock, a web UI, accounts, a network call inside `claim`, and any automatic choice of which agent should work next.
