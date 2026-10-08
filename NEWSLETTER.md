# Newsletter draft

Not sent. One issue, one call to action.

**Subject:** The second coding agent should have to wait

**Preview:** A local board so Cursor, Claude Code, Codex, and Devin stop editing the same file.

---

I watched two agents fix the same function.

Cursor had src/checkout.ts open and was halfway through the write. Claude Code, in another window, decided the bug was obvious and rewrote it. Both diffs compiled. Neither mentioned the other. I was the merge queue, which is a bad job for a person who already has a computer.

The failure is ordinary. Each tool keeps its own transcript. None of them has a shared "I have this file until 14:30, and here is what I learned." When the second agent starts, it starts from the repo, not from the first agent's head.

I built a small board for that, called jev-orchestrator, and put it up as a public repo.

It is a folder, `.jev`, plus a CLI. You add a task and the paths it touches. An agent claims it. The claim is a lease, 30 minutes unless you say otherwise. A second claim on an overlapping path is refused, with the holder's name in the error. When the first agent stops, it writes a handoff in Markdown: what it did, what the next agent should do, what it should leave alone. Then the lease drops and the next agent can claim.

I wired the instructions to the files those tools already read.

- Codex reads `AGENTS.md`. I did not invent a config key.
- Devin reads `AGENTS.md` too, and a `.devin/rules` file with `trigger: always_on`. The shared block sits at the top, inside the 16 KiB Devin injects on its own.
- Cursor gets that same `AGENTS.md`, plus a project rule with `alwaysApply: true`.
- Claude Code is the awkward one. If the repo has a `CLAUDE.md`, Claude's default is to ignore `AGENTS.md`. So the generated `CLAUDE.md` starts with `@AGENTS.md`, which is the import Claude actually expands.

There is no account. The demo makes no network call. `npm install` and `npm run demo` show the refusal and the handoff on your machine.

A few limits, so this does not sound like a platform.

The lock is the filesystem on one machine. Devin running in the cloud and Cursor running on your laptop do not share it. You can commit `tasks.json` and the handoff files so the other clone can see the queue. You still pull before you claim, because v1 has no cross-machine mutex. Instruction files are advice. The enforcement is the agent actually running `claim` and `check`.

I kept model routing out of it. I have another project, jev-model-router, whose only job is to pick a model for a prompt. This board's job is to pick a holder for a task. If you already routed a prompt, you can stamp the tier and the model id onto the task as a hint. The board stores the hint. It does not call anyone to check it. A lease should work with the wifi off.

If you are the person who keeps two coding agents pointed at one repo, run the demo and see if the refusal is the behaviour you wanted.

https://github.com/EdisonTKPcom/jev-orchestrator

Edison

---

**CTA:** clone the repo and run `npm run demo`. That is the ask. A star is optional and is not the point of the issue.
