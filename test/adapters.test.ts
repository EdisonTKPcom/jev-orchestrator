import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Board } from "../src/board.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("init adapters", () => {
  it("writes the files each tool actually reads, and a second init is a no-op", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-orch-adapt-"));
    dirs.push(dir);
    const board = new Board(dir);
    await board.init();
    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    const claude = await readFile(join(dir, "CLAUDE.md"), "utf8");
    const cursor = await readFile(join(dir, ".cursor/rules/jev-orchestrator.mdc"), "utf8");
    const devin = await readFile(join(dir, ".devin/rules/jev-orchestrator.md"), "utf8");
    expect(agents).toContain("jev-orchestrator claim");
    expect(claude.startsWith("@AGENTS.md\n")).toBe(true);
    expect(claude).toContain("claude-code");
    expect(cursor).toContain("alwaysApply: true");
    expect(cursor).toContain("`cursor`");
    expect(devin).toContain("trigger: always_on");
    expect(devin).toContain("`devin`");
    expect(existsSync(join(dir, ".codex/config.toml"))).toBe(false);
    const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".jev/claims/");
    expect(gitignore).not.toContain("tasks.json");

    const again = await board.init();
    expect(again.wrote).toEqual([]);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe(agents);
    expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toBe(claude);
  });

  it("keeps an existing AGENTS.md and CLAUDE.md, and does not clobber a foreign cursor rule", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-orch-adapt-"));
    dirs.push(dir);
    await writeFile(join(dir, "AGENTS.md"), "Team rules\n");
    await writeFile(join(dir, "CLAUDE.md"), "Use plan mode for billing.\n");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".cursor/rules"), { recursive: true });
    await writeFile(join(dir, ".cursor/rules/jev-orchestrator.mdc"), "---\nalwaysApply: false\n---\nours\n");
    const board = new Board(dir);
    const report = await board.init();
    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agents.startsWith("<!-- jev-orchestrator:agents -->")).toBe(true);
    expect(agents).toContain("Team rules");
    const claude = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(claude).toContain("@AGENTS.md");
    expect(claude).toContain("Use plan mode for billing.");
    expect(report.skipped).toContain(".cursor/rules/jev-orchestrator.mdc");
    expect(await readFile(join(dir, ".cursor/rules/jev-orchestrator.mdc"), "utf8")).toContain("ours");
    const second = await board.init();
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe(agents);
    expect(second.wrote).not.toContain("AGENTS.md");
  });
});
