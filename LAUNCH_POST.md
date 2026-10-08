# Launch drafts

Nothing in this file has been posted. No email has been sent.

## X

Cursor was halfway through src/checkout.ts. Claude Code rewrote the same function.

I got tired of being the merge queue for my own agents, so I made a small board they can share.

An agent claims the task. The next one gets a refusal, and a Markdown handoff when the first one stops. Cursor, Claude Code, Codex, and Devin use the same commands. The board is a folder in the repo. No account, no API key. The lock is the filesystem on that machine, which is also the limit: two laptops do not share it yet.

npm install && npm run demo

https://github.com/EdisonTKPcom/jev-orchestrator

## LinkedIn

I had Cursor and Claude Code open on the same bug.

Cursor was in src/checkout.ts. Claude Code decided to fix it too. I spent the next ten minutes picking a winner out of two diffs that both thought they were right.

The missing piece was boring. A queue. One task, the files it touches, who holds it, and a note for the next agent that is a file, not a memory of a chat.

So I published jev-orchestrator. It is a CLI and a directory named .jev. You add a task, an agent claims it, and a second claim on that file is refused until the lease ends or the holder hands off. The handoff is Markdown in the repo: what changed, what to do next, what to leave alone.

Cursor, Claude Code, Codex, and Devin each get the instruction file they already know how to read. Codex and Devin use AGENTS.md. Claude Code gets a CLAUDE.md that imports it, because if both files exist Claude skips AGENTS.md unless you import it. Cursor gets an always-on project rule. There is no new account and no token in the protocol.

v1 is honest about the lock. It is local to one machine. Devin in the cloud and Cursor on a laptop do not magically share it. If you need the queue on another clone, commit tasks.json and the handoffs, pull before you claim, and read the context packet if the push loses.

I also keep model choice in a separate tool, jev-model-router. That one decides which model a prompt needs. This one decides which agent is allowed to touch the file. A lease is a fact. A model tier is a judgement. I did not want the board to require an API key just to say "Claude Code, wait."

If you run more than one coding agent in the same repo, clone it and run the demo. It is offline, and the second claim fails on purpose.

https://github.com/EdisonTKPcom/jev-orchestrator
