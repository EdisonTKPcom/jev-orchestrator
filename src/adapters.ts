import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

export interface InstallReport {
  wrote: string[];
  skipped: string[];
  notes: string[];
}

const AGENTS_START = "<!-- jev-orchestrator:agents -->";
const AGENTS_END = "<!-- /jev-orchestrator:agents -->";
const CLAUDE_START = "<!-- jev-orchestrator:claude -->";
const CLAUDE_END = "<!-- /jev-orchestrator:claude -->";
const OWNED = "<!-- jev-orchestrator -->";

const GITIGNORE_BLOCK = `# >>> jev-orchestrator
.jev/board.lock
.jev/claims/
.jev/events.jsonl
# <<< jev-orchestrator
`;

const BOARD_README = `# .jev

Local board for jev-orchestrator protocol v1.

- \`tasks.json\` is the board. Commit it when another clone should see the tasks.
- \`handoffs/\` is what the next agent reads. Commit those files with the board.
- \`claims/\`, \`events.jsonl\`, and \`board.lock\` stay on this machine. They are gitignored.

The lock is this filesystem. Two clones do not share it.
`;

export function protocolMarkdownPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../adapters/protocol.md"), join(here, "../../adapters/protocol.md")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("adapters/protocol.md is missing from the package");
}

export async function installAdapters(root: string): Promise<InstallReport> {
  const protocol = (await readFile(protocolMarkdownPath(), "utf8")).trim();
  const report: InstallReport = { wrote: [], skipped: [], notes: [] };
  await writeText(
    root,
    "AGENTS.md",
    (existing) => agentsFile(existing, protocol),
    report,
  );
  await writeText(root, "CLAUDE.md", (existing) => claudeFile(existing), report);
  await writeOwned(
    root,
    ".cursor/rules/jev-orchestrator.mdc",
    cursorRule(protocol),
    report,
  );
  await writeOwned(root, ".devin/rules/jev-orchestrator.md", devinRule(protocol), report);
  return report;
}

export async function ensureGitignore(root: string): Promise<InstallReport> {
  const report: InstallReport = { wrote: [], skipped: [], notes: [] };
  const path = join(root, ".gitignore");
  const existing = await readOptional(path);
  if (existing?.includes("# >>> jev-orchestrator")) {
    report.skipped.push(".gitignore");
    return report;
  }
  const next = existing ? `${existing.trimEnd()}\n\n${GITIGNORE_BLOCK}` : GITIGNORE_BLOCK;
  await writeFile(path, next.endsWith("\n") ? next : `${next}\n`);
  report.wrote.push(".gitignore");
  report.notes.push("Claims, the lock, and the event log are gitignored. tasks.json and handoffs are not.");
  return report;
}

export async function ensureBoardReadme(dir: string): Promise<void> {
  const path = join(dir, "README.md");
  if (existsSync(path)) return;
  await writeFile(path, BOARD_README);
}

function agentsFile(existing: string | null, protocol: string): string {
  const block = protocol;
  if (existing === null) {
    return `# AGENTS.md\n\nThis file is read by Codex, Cursor, Devin, and Claude Code.\n\n${wrap(AGENTS_START, AGENTS_END, block)}`;
  }
  return upsert(existing, AGENTS_START, AGENTS_END, block, "prepend");
}

function claudeFile(existing: string | null): string {
  const section = [
    "Your agent id for this board is `claude-code`.",
    "Follow the imported AGENTS.md. Claim a task before you edit its files.",
  ].join("\n");
  if (existing === null) {
    return `@AGENTS.md\n\n${wrap(CLAUDE_START, CLAUDE_END, section)}`;
  }
  return upsert(ensureAgentsImport(existing), CLAUDE_START, CLAUDE_END, section, "append");
}

function cursorRule(protocol: string): string {
  return `---
description: Claim work on the shared jev-orchestrator board before editing
alwaysApply: true
---

${OWNED}

Your agent id for this board is \`cursor\`.

${protocol}
`;
}

function devinRule(protocol: string): string {
  return `---
description: Claim work on the shared jev-orchestrator board before editing
trigger: always_on
---

${OWNED}

Your agent id for this board is \`devin\`.

${protocol}
`;
}

function wrap(start: string, end: string, body: string): string {
  return `${start}\n${body.trim()}\n${end}\n`;
}

function upsert(existing: string, start: string, end: string, body: string, where: "prepend" | "append"): string {
  const wrapped = wrap(start, end, body);
  const at = existing.indexOf(start);
  const stop = existing.indexOf(end);
  if (at !== -1 && stop > at) {
    const before = existing.slice(0, at);
    const after = existing.slice(stop + end.length).replace(/^\r?\n/, "");
    return `${before}${wrapped}${after}`;
  }
  if (existing.trim() === "") return wrapped;
  if (where === "prepend") return `${wrapped}\n${existing.replace(/^\n/, "")}`;
  return `${existing.trimEnd()}\n\n${wrapped}`;
}

function ensureAgentsImport(text: string): string {
  if (/^@(\.\/)?AGENTS\.md\s*$/m.test(text)) return text;
  return `@AGENTS.md\n\n${text}`;
}

async function writeText(
  root: string,
  rel: string,
  render: (existing: string | null) => string,
  report: InstallReport,
): Promise<void> {
  const path = join(root, rel);
  const existing = await readOptional(path);
  const next = render(existing);
  if (existing === next) {
    report.skipped.push(rel);
    return;
  }
  await writeFile(path, next);
  report.wrote.push(rel);
}

async function writeOwned(root: string, rel: string, contents: string, report: InstallReport): Promise<void> {
  const path = join(root, rel);
  const existing = await readOptional(path);
  if (existing !== null && !existing.includes(OWNED)) {
    report.skipped.push(rel);
    report.notes.push(`skipped ${rel}: a file is already there, so it was left unchanged`);
    return;
  }
  if (existing === contents) {
    report.skipped.push(rel);
    return;
  }
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  report.wrote.push(rel);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
