#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { Board } from "./board.js";
import { BoardError, exitCodeFor } from "./errors.js";
import { defaultHolder } from "./identity.js";
import { modelHintFromParts, type ModelHintParts } from "./model-hint.js";
import { runDemo } from "./demo.js";
import { formatRemaining, parseTtl } from "./time.js";
import type { ModelHint, Task } from "./types.js";

export interface Io {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  cwd: string;
}

const HELP = `jev-orchestrator — a local board for coding agents

Cursor, Claude Code, Codex, and Devin claim a task, leave a handoff, and
stay off each other's files. The board is the .jev directory. No account.

  jev-orchestrator init [--dir <repo>] [--no-adapters]
  jev-orchestrator add --title <text> [--body <text>] [--path <path> ...]
                       [--prefer <agent>] [--model-tier <tier>] [--model-id <id>]
                       [--model-task <kind>] [--model-note <text>]
                       [--model-source manual|jev-model-router]
  jev-orchestrator list
  jev-orchestrator show <id>
  jev-orchestrator context <id>
  jev-orchestrator check --path <path> [...]
  jev-orchestrator claim <id> --agent <agent> [--holder <name>] [--ttl 30m]
  jev-orchestrator heartbeat <id> --agent <agent> [--holder <name>] [--ttl 30m]
  jev-orchestrator status <id> --agent <agent> --state blocked|claimed [--note <text>]
  jev-orchestrator handoff <id> --agent <agent> --to <agent> --done <text> --next <text>
                       [--avoid <text>] [--question <text> ...] [--path <path> ...]
  jev-orchestrator release <id> --agent <agent> [--force]
  jev-orchestrator done <id> --agent <agent> [--note <text>]
  jev-orchestrator demo

Agents: cursor, claude-code, codex, devin, generic
Exit codes: 0 ok, 1 bad request, 2 conflict, 3 secret rejected, 4 missing task,
            5 board not initialised, 6 board busy

--allow-sensitive skips the token scan. The scan is a backstop, not a vault.
`;

export async function main(argv: string[], io?: Partial<Io>): Promise<number> {
  const stdout = io?.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io?.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const cwd = io?.cwd ?? process.cwd();
  try {
    return await dispatch(argv, { stdout, stderr, cwd });
  } catch (error) {
    if (error instanceof BoardError) {
      stderr(`${error.message}\n`);
      return exitCodeFor(error);
    }
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function dispatch(argv: string[], io: Io): Promise<number> {
  const args = parseArgv(argv);
  if (args.flags.get("help") === true || args.command === "help" || args.command === "") {
    io.stdout(HELP);
    return 0;
  }
  if (args.flags.get("version") === true || args.command === "version") {
    io.stdout(`${readVersion()}\n`);
    return 0;
  }
  if (args.command === "demo") {
    const lines: string[] = [];
    await runDemo((line) => lines.push(line));
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  }

  const root = resolve(io.cwd, stringFlag(args.flags, "dir") ?? ".");
  const board = new Board(root);
  const allowSensitive = args.flags.get("allow-sensitive") === true;
  if (allowSensitive) io.stderr("warning: token scan skipped for this command\n");

  switch (args.command) {
    case "init": {
      const report = await board.init({ adapters: args.flags.get("no-adapters") !== true });
      for (const file of report.wrote) io.stdout(`wrote ${file}\n`);
      for (const file of report.skipped) io.stdout(`kept ${file}\n`);
      for (const note of report.notes) io.stdout(`${note}\n`);
      io.stdout("next  jev-orchestrator add --title \"...\" --path <file>\n");
      return 0;
    }
    case "add": {
      const title = stringFlag(args.flags, "title");
      if (!title) throw new BoardError("bad_request", "add needs --title");
      const hint = hintFromFlags(args.flags);
      const prefer = stringFlag(args.flags, "prefer");
      const body = stringFlag(args.flags, "body");
      const task = await board.add({
        title,
        paths: listFlag(args.flags, "path"),
        allowSensitive,
        ...(body !== undefined ? { body } : {}),
        ...(prefer !== undefined ? { preferredAgent: prefer } : {}),
        ...(hint ? { modelHint: hint } : {}),
      });
      io.stdout(`${task.id} open\n`);
      return 0;
    }
    case "list": {
      const tasks = await board.list();
      if (tasks.length === 0) {
        io.stdout("no tasks\n");
        return 0;
      }
      const now = Date.now();
      for (const task of tasks) io.stdout(`${formatTask(task, now)}\n`);
      return 0;
    }
    case "show": {
      const id = needId(args.positionals);
      io.stdout(`${JSON.stringify(await board.show(id), null, 2)}\n`);
      return 0;
    }
    case "context": {
      io.stdout(await board.context(needId(args.positionals)));
      return 0;
    }
    case "check": {
      const holds = await board.check(listFlag(args.flags, "path"));
      if (holds.length === 0) {
        io.stdout(`clear ${listFlag(args.flags, "path").join(" ")}\n`);
        return 0;
      }
      for (const hold of holds) {
        io.stdout(`${hold.path} held by ${hold.agent} (${hold.holder}) on ${hold.taskId} until ${hold.expiresAt}\n`);
      }
      return 2;
    }
    case "claim":
    case "heartbeat": {
      const id = needId(args.positionals);
      const ttl = stringFlag(args.flags, "ttl");
      const input = {
        agent: needAgent(args.flags),
        holder: stringFlag(args.flags, "holder") ?? defaultHolder(),
        ...(ttl !== undefined ? { ttlMs: parseTtl(ttl) } : {}),
      };
      const task = args.command === "claim" ? await board.claim(id, input) : await board.heartbeat(id, input);
      const expires = task.claim?.expiresAt ?? "";
      io.stdout(`${args.command} ${task.id} ${task.claim?.agent ?? ""} until ${expires}\n`);
      return 0;
    }
    case "status": {
      const state = stringFlag(args.flags, "state");
      if (state !== "blocked" && state !== "claimed") {
        throw new BoardError("bad_request", "status needs --state blocked or --state claimed");
      }
      const note = stringFlag(args.flags, "note");
      const task = await board.setStatus(needId(args.positionals), {
        agent: needAgent(args.flags),
        holder: stringFlag(args.flags, "holder") ?? defaultHolder(),
        state,
        allowSensitive,
        ...(note !== undefined ? { note } : {}),
      });
      io.stdout(`${task.id} ${task.status}\n`);
      return 0;
    }
    case "handoff": {
      const done = stringFlag(args.flags, "done");
      const next = stringFlag(args.flags, "next");
      const to = stringFlag(args.flags, "to");
      if (!done || !next || !to) throw new BoardError("bad_request", "handoff needs --to, --done, and --next");
      const avoid = stringFlag(args.flags, "avoid");
      const hint = hintFromFlags(args.flags);
      const task = await board.handoff(needId(args.positionals), {
        agent: needAgent(args.flags),
        holder: stringFlag(args.flags, "holder") ?? defaultHolder(),
        to,
        done,
        next,
        questions: listFlag(args.flags, "question"),
        paths: listFlag(args.flags, "path"),
        allowSensitive,
        ...(avoid !== undefined ? { avoid } : {}),
        ...(hint ? { modelHint: hint } : {}),
      });
      const latest = task.handoffs[task.handoffs.length - 1] ?? "";
      io.stdout(`handoff ${task.id} prefers ${task.preferredAgent ?? to} ${latest}\n`);
      return 0;
    }
    case "release": {
      const task = await board.release(needId(args.positionals), {
        agent: needAgent(args.flags),
        holder: stringFlag(args.flags, "holder") ?? defaultHolder(),
        ...(args.flags.get("force") === true ? { force: true } : {}),
      });
      io.stdout(`released ${task.id}\n`);
      return 0;
    }
    case "done": {
      const note = stringFlag(args.flags, "note");
      const task = await board.complete(needId(args.positionals), {
        agent: needAgent(args.flags),
        holder: stringFlag(args.flags, "holder") ?? defaultHolder(),
        allowSensitive,
        ...(note !== undefined ? { note } : {}),
      });
      io.stdout(`done ${task.id}\n`);
      return 0;
    }
    default:
      throw new BoardError("bad_request", `unknown command ${args.command}\n\n${HELP}`);
  }
}

function formatTask(task: Task, now: number): string {
  const who =
    task.claim && (task.status === "claimed" || task.status === "blocked")
      ? `${task.claim.agent} ${formatRemaining(task.claim.expiresAt, now)}`
      : task.preferredAgent
        ? `prefers ${task.preferredAgent}`
        : "";
  const paths = task.paths.length > 0 ? task.paths.join(", ") : "(no paths)";
  return `${task.id}  ${task.status.padEnd(8)} ${who.padEnd(22)} ${task.title}\n      ${paths}`;
}

function hintFromFlags(flags: Map<string, string | string[] | true>): ModelHintParts | undefined {
  const tier = stringFlag(flags, "model-tier");
  const taskKind = stringFlag(flags, "model-task");
  const modelId = stringFlag(flags, "model-id");
  const note = stringFlag(flags, "model-note");
  const sourceRaw = stringFlag(flags, "model-source");
  if (!tier && !taskKind && !modelId && !note && !sourceRaw) return undefined;
  if (sourceRaw !== undefined && sourceRaw !== "manual" && sourceRaw !== "jev-model-router") {
    throw new BoardError("bad_request", "--model-source must be manual or jev-model-router");
  }
  const source: ModelHint["source"] = sourceRaw === "jev-model-router" ? "jev-model-router" : "manual";
  return modelHintFromParts({
    source,
    ...(tier !== undefined ? { tier } : {}),
    ...(taskKind !== undefined ? { taskKind } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(note !== undefined ? { note } : {}),
  });
}

function needAgent(flags: Map<string, string | string[] | true>): string {
  const agent = stringFlag(flags, "agent");
  if (!agent) throw new BoardError("bad_request", "this command needs --agent");
  return agent;
}

function needId(positionals: string[]): string {
  const id = positionals[0];
  if (!id) throw new BoardError("bad_request", "this command needs a task id");
  return id;
}

interface Parsed {
  command: string;
  positionals: string[];
  flags: Map<string, string | string[] | true>;
}

const REPEATABLE = new Set(["path", "question"]);
const BOOLEANS = new Set(["help", "version", "allow-sensitive", "force", "no-adapters"]);

export function parseArgv(argv: string[]): Parsed {
  const flags = new Map<string, string | string[] | true>();
  const positionals: string[] = [];
  let command = "";
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === "--") {
      positionals.push(...argv.slice(i + 1).filter((item): item is string => item !== undefined));
      break;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (!key || key.startsWith("-")) throw new BoardError("bad_request", `bad flag ${token}`);
      if (BOOLEANS.has(key)) {
        flags.set(key, true);
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new BoardError("bad_request", `--${key} needs a value`);
      }
      i += 1;
      if (REPEATABLE.has(key)) {
        const previous = flags.get(key);
        const list = Array.isArray(previous) ? previous : [];
        list.push(value);
        flags.set(key, list);
      } else if (flags.has(key)) {
        throw new BoardError("bad_request", `--${key} was given twice`);
      } else {
        flags.set(key, value);
      }
      continue;
    }
    if (!command) command = token;
    else positionals.push(token);
  }
  return { command, positionals, flags };
}

function stringFlag(flags: Map<string, string | string[] | true>, key: string): string | undefined {
  const value = flags.get(key);
  if (typeof value === "string") return value;
  return undefined;
}

function listFlag(flags: Map<string, string | string[] | true>, key: string): string[] {
  const value = flags.get(key);
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../package.json"), join(here, "../../package.json")];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      /* try the next location */
    }
  }
  return "0.1.0";
}

function isEntry(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (isEntry()) {
  process.exit(await main(process.argv.slice(2)));
}
