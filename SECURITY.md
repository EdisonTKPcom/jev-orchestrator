# Security

jev-orchestrator stores a queue on disk. It does not authenticate callers. The trust boundary is the operating system: whoever can write the working tree can write `.jev/`.

## What not to put on the board

Titles, bodies, notes, handoffs, and holder strings are plain files. Keep API keys, passwords, private keys, and the contents of `.env` out of them.

The CLI rejects a few well-known token shapes (OpenAI-style keys, Anthropic keys, GitHub tokens, AWS access key ids, Slack tokens, bearer tokens, private-key headers). The check is a backstop. It will miss tokens that do not match those patterns. `--allow-sensitive` disables it and prints a warning.

The error text names the pattern. It does not echo the secret.

## What gets written

- `tasks.json` and handoff Markdown are the shared record. If you commit them, they are as public as the repo.
- The default holder is `username@hostname`. Pass `--holder` if you do not want that string in a committed board.
- `events.jsonl` stores event type, task id, agent, and holder. It does not store handoff bodies. It is gitignored by `init`.
- `board.lock` contains a pid and a nonce. It is gitignored.

## Reporting

If you find a bug that would leak a secret or let one local process smash another's claim, use GitHub private vulnerability reporting on this repository once it is enabled. Do not open a public issue that contains a live token.
