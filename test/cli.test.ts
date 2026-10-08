import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (chunk: string) => {
        stdout += chunk;
      },
      stderr: (chunk: string) => {
        stderr += chunk;
      },
      cwd: process.cwd(),
    },
    text: () => ({ stdout, stderr }),
  };
}

describe("cli", () => {
  it("runs the demo", async () => {
    const cap = capture();
    const code = await main(["demo"], cap.io);
    const { stdout } = cap.text();
    expect(code).toBe(0);
    expect(stdout).toContain("claim      claude-code   refused    T001 is held by cursor");
    expect(stdout).toContain("claim      devin         refused    src/checkout.ts overlaps T001 held by codex");
    expect(stdout).toContain("claim      devin         accepted   T002");
    expect(stdout).toContain("No account. No token.");
  });

  it("claims through the CLI and exits 2 when the path is held", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-orch-cli-"));
    dirs.push(dir);
    const cap = capture();
    expect(await main(["init", "--dir", dir, "--no-adapters"], cap.io)).toBe(0);
    expect(await main(["add", "--dir", dir, "--title", "Fix checkout", "--path", "src/checkout.ts"], cap.io)).toBe(0);
    expect(
      await main(["claim", "T001", "--dir", dir, "--agent", "cursor", "--holder", "ada", "--ttl", "10s"], cap.io),
    ).toBe(0);
    const check = capture();
    expect(await main(["check", "--dir", dir, "--path", "src/checkout.ts"], check.io)).toBe(2);
    expect(check.text().stdout).toContain("held by cursor");
    const clash = capture();
    expect(
      await main(["claim", "T001", "--dir", dir, "--agent", "claude-code", "--holder", "ada"], clash.io),
    ).toBe(2);
    const secret = capture();
    expect(
      await main(["add", "--dir", dir, "--title", `sk-${"c".repeat(24)}`], secret.io),
    ).toBe(3);
  });

  it("rejects a short ttl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-orch-cli-"));
    dirs.push(dir);
    const cap = capture();
    await main(["init", "--dir", dir, "--no-adapters"], cap.io);
    await main(["add", "--dir", dir, "--title", "A"], cap.io);
    const bad = capture();
    expect(await main(["claim", "T001", "--dir", dir, "--agent", "cursor", "--ttl", "1s"], bad.io)).toBe(1);
  });
});
