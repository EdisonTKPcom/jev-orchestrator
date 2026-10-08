# Protocol v1

The board is a directory named `.jev` at the root of a project. Version is the integer `protocol` in `tasks.json`. This CLI speaks version 1 only.

## Layout

```
.jev/tasks.json       board. Commit this if another clone should see the tasks.
.jev/handoffs/<id>/   markdown packets. Commit these with the board.
.jev/claims/<id>.json copy of the active lease. Gitignore. Derived from tasks.json.
.jev/events.jsonl     local audit log. Gitignore. No handoff bodies.
.jev/board.lock       mutex. Gitignore. Never commit it.
.jev/README.md        short note so the directory is not a mystery.
```

`tasks.json` is the source of truth. Claim receipts exist so a person can see who holds what without parsing the whole board.

## tasks.json

```json
{
  "protocol": 1,
  "tasks": [
    {
      "id": "T001",
      "title": "Stop the double write in checkout",
      "body": "",
      "status": "claimed",
      "paths": ["src/checkout.ts"],
      "revision": 2,
      "createdAt": "2026-10-08T00:00:00.000Z",
      "updatedAt": "2026-10-08T00:01:00.000Z",
      "handoffs": [],
      "claim": {
        "agent": "cursor",
        "holder": "ada@laptop",
        "claimedAt": "2026-10-08T00:01:00.000Z",
        "heartbeatAt": "2026-10-08T00:01:00.000Z",
        "expiresAt": "2026-10-08T00:31:00.000Z"
      }
    }
  ]
}
```

Optional fields, omitted when empty: `claim`, `preferredAgent`, `blockedReason`, `modelHint`.

`modelHint` is a note from the caller. `source` is `manual` or `jev-model-router`. The board stores it and copies it into the handoff. It does not contact a model provider.

Agent ids: `cursor`, `claude-code`, `codex`, `devin`, `generic`.

## States

```
open --claim--> claimed
claimed --heartbeat--> claimed
claimed --status blocked--> blocked
blocked --status claimed--> claimed
claimed or blocked --handoff--> open   (preferredAgent set, claim cleared)
claimed or blocked --release--> open
claimed or blocked --done--> done
```

`done` stays done. Add another task. A `blocked` task still holds its paths until release, handoff, done, or expiry.

## Claim

Inside the lock:

1. Missing id, bad id, or `done`: refuse.
2. Same agent and same holder, lease still active: renew expiry. A blocked task stays blocked.
3. Any other active lease: refuse, and name the holder.
4. If any other active task has an overlapping path: refuse, and name that task.
5. Otherwise write the lease, set status to `claimed`, and clear a stale blocked reason.

An expired lease can be taken. The event type is `steal`.

The lock file is created with `O_EXCL`. The holder writes a nonce and deletes the file only if the nonce still matches, so a slow writer cannot remove a lock that was already stolen. A lock older than 15 seconds, or whose pid is dead, can be removed. Mutations are local file writes. They are not a place to wait on the network.

## Paths

Stored paths are relative. `..`, absolute paths, `.jev`, and `.git` are rejected.

| Input | Stored as | Locks |
| --- | --- | --- |
| `src/checkout.ts` | `src/checkout.ts` | that file |
| `src/` or `src/**` or `src/*` | `src` | `src` and everything under it |
| `.` | `.` | every path |

`src/checkout.ts` does not overlap `src/checkout.ts.bak`. Other glob characters are rejected. Two tasks may list the same path. The second **claim** is what fails.

## Handoff file

`.jev/handoffs/T001/001.md`. Frontmatter is only ids, the timestamp, the revision, and the path list. Free text is in the body, under `Done`, `Next`, and optionally `Leave this alone`, `Open questions`, and `Model hint`.

## Events

One JSON object per line: `ts`, `type`, `task`, and when relevant `agent`, `holder`, `to`. Types: `add`, `claim`, `renew`, `steal`, `heartbeat`, `blocked`, `unblocked`, `handoff`, `release`, `force_release`, `done`. The line does not include the handoff body.

## Security

Anyone who can write the repo can write the board. The protocol has no access token because the filesystem is the boundary. Do not put API keys in task text. The CLI rejects a few well-known token shapes unless `--allow-sensitive` is passed. That flag is a bypass, not a feature to reach for.

Holder defaults to `username@hostname`. If you commit `tasks.json`, that string is in git. Pass `--holder` when you want a role name instead.

## What v1 does not do

Two machines do not share `board.lock`. Copying `tasks.json` through git replicates the desired tasks and handoffs. It does not stop two clones from both believing they hold the claim. Treat a committed board as a queue you pull before you claim, and treat a lost push as a sign to read `context` again.
