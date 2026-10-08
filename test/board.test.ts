import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Board } from "../src/board.js";
import { BoardError } from "../src/errors.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempBoard(now?: () => number): Promise<{ dir: string; board: Board }> {
  const dir = await mkdtemp(join(tmpdir(), "jev-orch-"));
  dirs.push(dir);
  const board = new Board(dir, now ? { now } : {});
  await board.init({ adapters: false });
  return { dir, board };
}

describe("Board", () => {
  it("lets one agent claim a task and refuses the next", async () => {
    const { board } = await tempBoard();
    const task = await board.add({ title: "Fix checkout", paths: ["src/checkout.ts"] });
    const claimed = await board.claim(task.id, { agent: "cursor", holder: "ada" });
    expect(claimed.status).toBe("claimed");
    expect(claimed.claim?.agent).toBe("cursor");
    await expect(board.claim(task.id, { agent: "claude-code", holder: "ada" })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses a second task whose path overlaps an active claim", async () => {
    const { board } = await tempBoard();
    const first = await board.add({ title: "A", paths: ["src/checkout.ts"] });
    await board.claim(first.id, { agent: "codex", holder: "ada" });
    const second = await board.add({ title: "B", paths: ["src"] });
    await expect(board.claim(second.id, { agent: "devin", holder: "ada" })).rejects.toMatchObject({
      code: "conflict",
    });
    const holds = await board.check(["src/checkout.ts"]);
    expect(holds.map((hold) => hold.taskId)).toEqual([first.id]);
  });

  it("allows a steal after the lease expires and records it", async () => {
    let now = Date.parse("2026-10-08T00:00:00.000Z");
    const { dir, board } = await tempBoard(() => now);
    const task = await board.add({ title: "A", paths: ["a.ts"] });
    await board.claim(task.id, { agent: "cursor", holder: "ada", ttlMs: 60_000 });
    now += 50_000;
    await board.heartbeat(task.id, { agent: "cursor", holder: "ada", ttlMs: 60_000 });
    now += 50_000;
    await expect(board.claim(task.id, { agent: "codex", holder: "grace" })).rejects.toMatchObject({ code: "conflict" });
    now += 20_000;
    const stolen = await board.claim(task.id, { agent: "codex", holder: "grace", ttlMs: 60_000 });
    expect(stolen.claim?.agent).toBe("codex");
    const events = await readFile(join(dir, ".jev", "events.jsonl"), "utf8");
    expect(events).toContain('"type":"steal"');
    expect(events).toContain('"type":"heartbeat"');
  });

  it("hands off context, releases the lock, and keeps the packet", async () => {
    const { dir, board } = await tempBoard();
    const task = await board.add({
      title: "Fix checkout",
      paths: ["src/checkout.ts"],
      modelHint: { source: "jev-model-router", tier: "frontier", modelId: "claude-opus-5-5" },
    });
    await board.claim(task.id, { agent: "cursor", holder: "ada" });
    const handed = await board.handoff(task.id, {
      agent: "cursor",
      holder: "ada",
      to: "codex",
      done: "Reproduced the race.",
      next: "Add the lock.",
      avoid: "Do not rewrite the tests.",
    });
    expect(handed.status).toBe("open");
    expect(handed.preferredAgent).toBe("codex");
    expect(handed.claim).toBeUndefined();
    const rel = handed.handoffs[0];
    expect(rel).toBeDefined();
    const markdown = await readFile(join(dir, rel!), "utf8");
    expect(markdown).toContain("## Next");
    expect(markdown).toContain("Add the lock.");
    expect(markdown).toContain("claude-opus-5-5");
    const packet = await board.context(task.id);
    expect(packet).toContain("preferred next agent: codex");
    expect(packet).toContain("Add the lock.");
    await board.claim(task.id, { agent: "codex", holder: "grace" });
  });

  it("blocks a non-holder from finishing the task", async () => {
    const { board } = await tempBoard();
    const task = await board.add({ title: "A", paths: ["a.ts"] });
    await board.claim(task.id, { agent: "cursor", holder: "ada" });
    await expect(board.complete(task.id, { agent: "codex", holder: "grace" })).rejects.toMatchObject({
      code: "conflict",
    });
    await board.setStatus(task.id, { agent: "cursor", holder: "ada", state: "blocked", note: "waiting on schema" });
    const done = await board.complete(task.id, { agent: "cursor", holder: "ada", note: "shipped" });
    expect(done.status).toBe("done");
    await expect(board.claim(task.id, { agent: "devin", holder: "ada" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("rejects token-shaped notes and reserved paths", async () => {
    const { board } = await tempBoard();
    await expect(board.add({ title: `key sk-${"a".repeat(24)}` })).rejects.toMatchObject({ code: "sensitive" });
    await expect(board.add({ title: "ok", paths: ["../outside"] })).rejects.toMatchObject({ code: "bad_request" });
    const task = await board.add({ title: "ok", paths: ["a.ts"], allowSensitive: false });
    await board.claim(task.id, { agent: "generic", holder: "ada" });
    await expect(
      board.handoff(task.id, {
        agent: "generic",
        holder: "ada",
        to: "cursor",
        done: "done",
        next: `ghp_${"b".repeat(24)}`,
      }),
    ).rejects.toMatchObject({ code: "sensitive" });
  });

  it("force-releases a live claim", async () => {
    const { board } = await tempBoard();
    const task = await board.add({ title: "A", paths: ["a.ts"] });
    await board.claim(task.id, { agent: "cursor", holder: "ada" });
    await expect(board.release(task.id, { agent: "codex", holder: "grace" })).rejects.toMatchObject({
      code: "conflict",
    });
    const released = await board.release(task.id, { agent: "codex", holder: "grace", force: true });
    expect(released.status).toBe("open");
    expect(released.claim).toBeUndefined();
  });

  it("serialises two claims so only one wins", async () => {
    const { board } = await tempBoard();
    const task = await board.add({ title: "A", paths: ["a.ts"] });
    const results = await Promise.allSettled([
      board.claim(task.id, { agent: "cursor", holder: "ada" }),
      board.claim(task.id, { agent: "codex", holder: "grace" }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("refuses a board from a newer protocol", async () => {
    const { dir, board } = await tempBoard();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, ".jev", "tasks.json"), `${JSON.stringify({ protocol: 2, tasks: [] })}\n`);
    await expect(board.list()).rejects.toMatchObject({ code: "protocol" });
  });
});
