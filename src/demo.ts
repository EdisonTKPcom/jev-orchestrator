import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Board } from "./board.js";
import { BoardError } from "./errors.js";

/**
 * Scripted proof: one file, three agents, a refusal, a handoff, then the lock lifts.
 * Throws if the board accepts a claim it should refuse.
 */
export async function runDemo(write: (line: string) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jev-orch-demo-"));
  try {
    const board = new Board(root);
    await board.init({ adapters: false });
    const first = await board.add({
      title: "Stop the double write in checkout",
      paths: ["src/checkout.ts"],
    });
    write("One task, three agents, one file.");
    write("");
    write(`  add        ${first.id}  ${first.title}`);
    write("             path  src/checkout.ts");

    await board.claim(first.id, { agent: "cursor", holder: "demo" });
    write(`  claim      cursor        accepted   ${first.id}`);

    await expectConflict(() => board.claim(first.id, { agent: "claude-code", holder: "demo" }), "cursor");
    write("  claim      claude-code   refused    T001 is held by cursor");

    const handed = await board.handoff(first.id, {
      agent: "cursor",
      holder: "demo",
      to: "codex",
      done: "Reproduced the double write.",
      next: "Add a file lock around the write",
    });
    const handoffPath = handed.handoffs[0];
    if (!handoffPath) throw new Error("handoff was not recorded");
    const markdown = await readFile(join(root, handoffPath), "utf8");
    if (!markdown.includes("Add a file lock around the write")) {
      throw new Error("handoff is missing the next step");
    }
    write("  handoff    cursor -> codex");
    write("             next  Add a file lock around the write");

    await board.claim(first.id, { agent: "codex", holder: "demo" });
    write(`  claim      codex         accepted   ${first.id}`);

    const second = await board.add({
      title: "Cover checkout with a regression test",
      paths: ["src/checkout.ts"],
    });
    write(`  add        ${second.id}  ${second.title}`);
    write("             path  src/checkout.ts");

    await expectConflict(
      () => board.claim(second.id, { agent: "devin", holder: "demo" }),
      "src/checkout.ts",
    );
    write("  claim      devin         refused    src/checkout.ts overlaps T001 held by codex");

    await board.complete(first.id, { agent: "codex", holder: "demo" });
    write(`  done       codex         accepted   ${first.id}`);

    await board.claim(second.id, { agent: "devin", holder: "demo" });
    write(`  claim      devin         accepted   ${second.id}`);
    write("");
    write("Board files stayed on this machine. No account. No token.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function expectConflict(run: () => Promise<unknown>, needle: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof BoardError && error.code === "conflict" && error.message.includes(needle)) return;
    throw error;
  }
  throw new Error("expected the board to refuse this claim");
}
