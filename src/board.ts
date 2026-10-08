import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ensureBoardReadme, ensureGitignore, installAdapters, type InstallReport } from "./adapters.js";
import { BoardError } from "./errors.js";
import { parseAgent, validateHolder } from "./identity.js";
import { withLock } from "./lock.js";
import { modelHintFromParts, type ModelHintParts } from "./model-hint.js";
import { normalizePath, pathsOverlap } from "./paths.js";
import { renderContext, renderHandoff } from "./render.js";
import { assertNoSecrets } from "./secrets.js";
import { assertTtl } from "./time.js";
import {
  PROTOCOL_VERSION,
  type AgentId,
  type BoardEvent,
  type BoardFile,
  type Claim,
  type ModelHint,
  type PathHold,
  type Task,
  type TaskStatus,
} from "./types.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface BoardOptions {
  now?: () => number;
  defaultTtlMs?: number;
}

export interface AddInput {
  title: string;
  body?: string;
  paths?: string[];
  preferredAgent?: AgentId | string;
  modelHint?: ModelHintParts;
  allowSensitive?: boolean;
}

export interface ClaimInput {
  agent: AgentId | string;
  holder: string;
  ttlMs?: number;
}

export interface HandoffInput {
  agent: AgentId | string;
  holder: string;
  to: AgentId | string;
  done: string;
  next: string;
  avoid?: string;
  questions?: string[];
  paths?: string[];
  modelHint?: ModelHintParts;
  allowSensitive?: boolean;
}

export interface StatusInput {
  agent: AgentId | string;
  holder: string;
  state: "blocked" | "claimed";
  note?: string;
  allowSensitive?: boolean;
}

export interface DoneInput {
  agent: AgentId | string;
  holder: string;
  note?: string;
  allowSensitive?: boolean;
}

export interface ReleaseInput {
  agent: AgentId | string;
  holder: string;
  force?: boolean;
}

interface Mutation {
  file: BoardFile;
  result: Task;
  event?: Omit<BoardEvent, "ts">;
}

/**
 * Protocol v1 board stored under `<root>/.jev`.
 * Mutations take a same-machine lock. The lock does not cross clones.
 */
export class Board {
  readonly root: string;
  readonly dir: string;
  private readonly now: () => number;
  private readonly defaultTtlMs: number;

  constructor(root: string, options: BoardOptions = {}) {
    this.root = root;
    this.dir = join(root, ".jev");
    this.now = options.now ?? (() => Date.now());
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
  }

  async init(options?: { adapters?: boolean }): Promise<InstallReport> {
    await mkdir(join(this.dir, "handoffs"), { recursive: true });
    await mkdir(join(this.dir, "claims"), { recursive: true });
    const tasksPath = join(this.dir, "tasks.json");
    const initial: BoardFile = { protocol: PROTOCOL_VERSION, tasks: [] };
    try {
      await writeFile(tasksPath, `${JSON.stringify(initial, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await ensureBoardReadme(this.dir);
    const gitignore = await ensureGitignore(this.root);
    if (options?.adapters === false) return gitignore;
    const adapters = await installAdapters(this.root);
    return {
      wrote: [...gitignore.wrote, ...adapters.wrote],
      skipped: [...gitignore.skipped, ...adapters.skipped],
      notes: [...gitignore.notes, ...adapters.notes],
    };
  }

  async add(input: AddInput): Promise<Task> {
    const title = requireText(input.title, "title", 200);
    const body = input.body === undefined || input.body.trim() === "" ? "" : requireText(input.body, "body", 8_000);
    const paths = (input.paths ?? []).map((path) => normalizePath(path));
    if (paths.length > 20) throw new BoardError("bad_request", "a task can lock at most 20 paths");
    const preferred = input.preferredAgent === undefined ? undefined : parseAgent(input.preferredAgent);
    const modelHint = input.modelHint ? modelHintFromParts(input.modelHint) : undefined;
    assertNoSecrets(
      [
        { field: "title", text: title },
        { field: "body", text: body },
        { field: "model note", text: modelHint?.note ?? "" },
        ...paths.map((path) => ({ field: "path", text: path })),
      ],
      input.allowSensitive === true,
    );
    return this.mutate(async (file) => {
      const now = this.iso(this.now());
      const task: Task = {
        id: nextId(file),
        title,
        body,
        status: "open",
        paths,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        handoffs: [],
      };
      if (preferred) task.preferredAgent = preferred;
      if (modelHint) task.modelHint = modelHint;
      file.tasks.push(task);
      return done(file, task, { type: "add", task: task.id });
    });
  }

  async list(): Promise<Task[]> {
    const file = await this.readBoard();
    return file.tasks.map(copyTask);
  }

  async show(id: string): Promise<Task> {
    const file = await this.readBoard();
    return copyTask(mustGet(file, id));
  }

  async claim(id: string, input: ClaimInput): Promise<Task> {
    const agent = parseAgent(input.agent);
    const holder = checkedHolder(input.holder);
    const ttl = input.ttlMs ?? this.defaultTtlMs;
    assertTtl(ttl);
    return this.mutate(async (file) => {
      const task = mustGet(file, id);
      if (task.status === "done") throw new BoardError("bad_request", `${id} is done. Add a new task.`);
      const now = this.now();
      const active = activeClaim(task, now);
      if (active && active.agent === agent && active.holder === holder) {
        task.claim = {
          agent: active.agent,
          holder: active.holder,
          claimedAt: active.claimedAt,
          heartbeatAt: this.iso(now),
          expiresAt: this.iso(now + ttl),
        };
        task.updatedAt = this.iso(now);
        task.revision += 1;
        await this.writeReceipt(task);
        return done(file, task, { type: "renew", task: id, agent, holder });
      }
      if (active) {
        throw new BoardError(
          "conflict",
          `${id} is held by ${active.agent} (${active.holder}) until ${active.expiresAt}. Read it with: jev-orchestrator context ${id}`,
        );
      }
      const overlap = findOverlap(file, task, now);
      if (overlap) {
        throw new BoardError(
          "conflict",
          `${overlap.path} overlaps ${overlap.otherId} held by ${overlap.agent} (${overlap.holder})`,
        );
      }
      const stolen = task.claim !== undefined;
      delete task.blockedReason;
      task.status = "claimed";
      task.claim = {
        agent,
        holder,
        claimedAt: this.iso(now),
        heartbeatAt: this.iso(now),
        expiresAt: this.iso(now + ttl),
      };
      task.updatedAt = this.iso(now);
      task.revision += 1;
      await this.writeReceipt(task);
      return done(file, task, { type: stolen ? "steal" : "claim", task: id, agent, holder });
    });
  }

  async heartbeat(id: string, input: ClaimInput): Promise<Task> {
    const agent = parseAgent(input.agent);
    const holder = checkedHolder(input.holder);
    const ttl = input.ttlMs ?? this.defaultTtlMs;
    assertTtl(ttl);
    return this.mutate(async (file) => {
      const task = mustGet(file, id);
      const active = requireHolder(task, agent, holder, this.now());
      const now = this.now();
      task.claim = {
        agent: active.agent,
        holder: active.holder,
        claimedAt: active.claimedAt,
        heartbeatAt: this.iso(now),
        expiresAt: this.iso(now + ttl),
      };
      task.updatedAt = this.iso(now);
      task.revision += 1;
      await this.writeReceipt(task);
      return done(file, task, { type: "heartbeat", task: id, agent, holder });
    });
  }

  async setStatus(id: string, input: StatusInput): Promise<Task> {
    const agent = parseAgent(input.agent);
    const holder = checkedHolder(input.holder);
    const note = input.note === undefined ? undefined : requireText(input.note, "note", 8_000);
    assertNoSecrets([{ field: "note", text: note ?? "" }], input.allowSensitive === true);
    return this.mutate(async (file) => {
      const task = mustGet(file, id);
      requireHolder(task, agent, holder, this.now());
      const now = this.iso(this.now());
      if (input.state === "blocked") {
        if (!note) throw new BoardError("bad_request", "a blocked task needs a --note");
        task.status = "blocked";
        task.blockedReason = note;
      } else {
        task.status = "claimed";
        delete task.blockedReason;
      }
      task.updatedAt = now;
      task.revision += 1;
      return done(file, task, {
        type: input.state === "blocked" ? "blocked" : "unblocked",
        task: id,
        agent,
        holder,
      });
    });
  }

  async handoff(id: string, input: HandoffInput): Promise<Task> {
    const agent = parseAgent(input.agent);
    const holder = checkedHolder(input.holder);
    const to = parseAgent(input.to);
    const doneText = requireText(input.done, "done", 8_000);
    const next = requireText(input.next, "next", 8_000);
    const avoid = input.avoid === undefined || input.avoid.trim() === "" ? undefined : requireText(input.avoid, "avoid", 4_000);
    const questions = (input.questions ?? []).map((question, index) =>
      requireText(question, `question ${index + 1}`, 500),
    );
    if (questions.length > 8) throw new BoardError("bad_request", "a handoff can carry at most 8 questions");
    const extraPaths = (input.paths ?? []).map((path) => normalizePath(path));
    const modelHint = input.modelHint ? modelHintFromParts(input.modelHint) : undefined;
    assertNoSecrets(
      [
        { field: "done", text: doneText },
        { field: "next", text: next },
        { field: "avoid", text: avoid ?? "" },
        { field: "model note", text: modelHint?.note ?? "" },
        ...questions.map((question) => ({ field: "question", text: question })),
      ],
      input.allowSensitive === true,
    );
    return this.mutate(async (file) => {
      const task = mustGet(file, id);
      requireHolder(task, agent, holder, this.now());
      const nowMs = this.now();
      task.paths = union(task.paths, extraPaths);
      if (modelHint) task.modelHint = modelHint;
      task.revision += 1;
      task.updatedAt = this.iso(nowMs);
      const name = `${String(task.handoffs.length + 1).padStart(3, "0")}.md`;
      const rel = `.jev/handoffs/${task.id}/${name}`;
      const markdown = renderHandoff({
        task,
        from: agent,
        to,
        at: this.iso(nowMs),
        done: doneText,
        next,
        ...(avoid ? { avoid } : {}),
        ...(questions.length > 0 ? { questions } : {}),
      });
      await mkdir(join(this.dir, "handoffs", task.id), { recursive: true });
      await writeFile(join(this.dir, "handoffs", task.id, name), markdown);
      task.handoffs.push(rel);
      delete task.claim;
      delete task.blockedReason;
      task.status = "open";
      task.preferredAgent = to;
      await this.clearReceipt(task.id);
      return done(file, task, { type: "handoff", task: id, agent, holder, to });
    });
  }

  async complete(id: string, input: DoneInput): Promise<Task> {
    const agent = parseAgent(input.agent);
    const holder = checkedHolder(input.holder);
    const note =
      input.note === undefined || input.note.trim() === "" ? "Completed." : requireText(input.note, "note", 8_000);
    assertNoSecrets([{ field: "note", text: note }], input.allowSensitive === true);
    return this.mutate(async (file) => {
      const task = mustGet(file, id);
      requireHolder(task, agent, holder, this.now());
      const nowMs = this.now();
      task.revision += 1;
      task.updatedAt = this.iso(nowMs);
      const name = `${String(task.handoffs.length + 1).padStart(3, "0")}.md`;
      const rel = `.jev/handoffs/${task.id}/${name}`;
      const markdown = renderHandoff({
        task,
        from: agent,
        to: "done",
        at: this.iso(nowMs),
        done: note,
        next: "No further work on this task.",
      });
      await mkdir(join(this.dir, "handoffs", task.id), { recursive: true });
      await writeFile(join(this.dir, "handoffs", task.id, name), markdown);
      task.handoffs.push(rel);
      delete task.claim;
      delete task.blockedReason;
      task.status = "done";
      await this.clearReceipt(task.id);
      return done(file, task, { type: "done", task: id, agent, holder });
    });
  }

  async release(id: string, input: ReleaseInput): Promise<Task> {
    const agent = parseAgent(input.agent);
    const holder = checkedHolder(input.holder);
    return this.mutate(async (file) => {
      const task = mustGet(file, id);
      const now = this.now();
      const active = activeClaim(task, now);
      if (!active) throw new BoardError("conflict", `${id} has no active claim.`);
      if (!input.force && (active.agent !== agent || active.holder !== holder)) {
        throw new BoardError("conflict", `${id} is held by ${active.agent} (${active.holder}).`);
      }
      delete task.claim;
      delete task.blockedReason;
      task.status = "open";
      task.updatedAt = this.iso(now);
      task.revision += 1;
      await this.clearReceipt(task.id);
      return done(file, task, {
        type: input.force ? "force_release" : "release",
        task: id,
        agent,
        holder,
      });
    });
  }

  async check(paths: string[]): Promise<PathHold[]> {
    if (paths.length === 0) throw new BoardError("bad_request", "check needs at least one --path");
    const wanted = paths.map((path) => normalizePath(path));
    const file = await this.readBoard();
    return holdsFor(file, wanted, this.now());
  }

  async context(id: string): Promise<string> {
    const file = await this.readBoard();
    const task = mustGet(file, id);
    const rel = task.handoffs[task.handoffs.length - 1];
    let latest: string | undefined;
    if (rel) {
      try {
        latest = await readFile(safeHandoff(this.root, task.id, rel), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const holds = holdsFor(file, task.paths, this.now()).filter((hold) => hold.taskId !== task.id);
    return renderContext(task, latest, holds, this.now());
  }

  private async readBoard(): Promise<BoardFile> {
    await this.requireInit();
    return withLock(join(this.dir, "board.lock"), async () => this.read());
  }

  private async mutate(fn: (file: BoardFile) => Promise<Mutation>): Promise<Task> {
    await this.requireInit();
    return withLock(join(this.dir, "board.lock"), async () => {
      const current = await this.read();
      const mutation = await fn(current);
      await this.write(mutation.file);
      if (mutation.event) await this.appendEvent(mutation.event);
      return copyTask(mutation.result);
    });
  }

  private async requireInit(): Promise<void> {
    try {
      await readFile(join(this.dir, "tasks.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BoardError("not_initialized", "No board here. Run: jev-orchestrator init");
      }
      throw error;
    }
  }

  private async read(): Promise<BoardFile> {
    const raw = await readFile(join(this.dir, "tasks.json"), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BoardError("bad_request", ".jev/tasks.json is not valid JSON");
    }
    return parseBoardFile(parsed);
  }

  private async write(file: BoardFile): Promise<void> {
    const path = join(this.dir, "tasks.json");
    const tmp = join(this.dir, `tasks.${process.pid}.tmp`);
    await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`);
    try {
      await rename(tmp, path);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  private async appendEvent(event: Omit<BoardEvent, "ts">): Promise<void> {
    const line: BoardEvent = { ...event, ts: this.iso(this.now()) };
    await appendFile(join(this.dir, "events.jsonl"), `${JSON.stringify(line)}\n`);
  }

  private async writeReceipt(task: Task): Promise<void> {
    if (!task.claim) return;
    await mkdir(join(this.dir, "claims"), { recursive: true });
    await writeFile(join(this.dir, "claims", `${task.id}.json`), `${JSON.stringify(task.claim, null, 2)}\n`);
  }

  private async clearReceipt(id: string): Promise<void> {
    await rm(join(this.dir, "claims", `${id}.json`), { force: true });
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString();
  }
}

function done(file: BoardFile, task: Task, event: Omit<BoardEvent, "ts">): Mutation {
  return { file, result: task, event };
}

function checkedHolder(holder: string): string {
  const trimmed = holder.trim();
  validateHolder(trimmed);
  assertNoSecrets([{ field: "holder", text: trimmed }], false);
  return trimmed;
}

function copyTask(task: Task): Task {
  return structuredClone(task);
}

function nextId(file: BoardFile): string {
  let max = 0;
  for (const task of file.tasks) {
    const match = /^T(\d+)$/.exec(task.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `T${String(max + 1).padStart(3, "0")}`;
}

function mustGet(file: BoardFile, id: string): Task {
  if (!/^T[0-9]{3,}$/.test(id)) throw new BoardError("bad_request", "task id must look like T001");
  const task = file.tasks.find((item) => item.id === id);
  if (!task) throw new BoardError("not_found", `no task ${id}`);
  return task;
}

function activeClaim(task: Task, now: number): Claim | undefined {
  if (!task.claim) return undefined;
  if (task.status !== "claimed" && task.status !== "blocked") return undefined;
  if (Date.parse(task.claim.expiresAt) <= now) return undefined;
  return task.claim;
}

function requireHolder(task: Task, agent: AgentId, holder: string, now: number): Claim {
  const active = activeClaim(task, now);
  if (!active) throw new BoardError("conflict", `${task.id} has no active claim. Claim it first.`);
  if (active.agent !== agent || active.holder !== holder) {
    throw new BoardError("conflict", `${task.id} is held by ${active.agent} (${active.holder}).`);
  }
  return active;
}

function findOverlap(
  file: BoardFile,
  task: Task,
  now: number,
): { path: string; otherId: string; agent: AgentId; holder: string } | undefined {
  for (const other of file.tasks) {
    if (other.id === task.id) continue;
    const hold = activeClaim(other, now);
    if (!hold) continue;
    for (const path of task.paths) {
      for (const otherPath of other.paths) {
        if (pathsOverlap(path, otherPath)) {
          return { path, otherId: other.id, agent: hold.agent, holder: hold.holder };
        }
      }
    }
  }
  return undefined;
}

function holdsFor(file: BoardFile, paths: string[], now: number): PathHold[] {
  const holds: PathHold[] = [];
  for (const path of paths) {
    for (const task of file.tasks) {
      const claim = activeClaim(task, now);
      if (!claim) continue;
      if (!task.paths.some((candidate) => pathsOverlap(path, candidate))) continue;
      holds.push({
        path,
        taskId: task.id,
        title: task.title,
        agent: claim.agent,
        holder: claim.holder,
        expiresAt: claim.expiresAt,
      });
    }
  }
  return holds;
}

function union(current: string[], extra: string[]): string[] {
  const out = [...current];
  for (const path of extra) if (!out.includes(path)) out.push(path);
  if (out.length > 20) throw new BoardError("bad_request", "a task can lock at most 20 paths");
  return out;
}

function requireText(value: string, field: string, max: number): string {
  if (isSingleLine(field) && /[\r\n]/.test(value)) {
    throw new BoardError("bad_request", `${field} must be a single line`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new BoardError("bad_request", `${field} is required`);
  if (trimmed.length > max) throw new BoardError("bad_request", `${field} must be at most ${max} characters`);
  return trimmed;
}

function isSingleLine(field: string): boolean {
  return field === "title" || field === "holder" || field.startsWith("question");
}

function parseBoardFile(raw: unknown): BoardFile {
  if (!raw || typeof raw !== "object") throw new BoardError("bad_request", ".jev/tasks.json is not an object");
  const record = raw as Record<string, unknown>;
  if (record["protocol"] !== PROTOCOL_VERSION) {
    throw new BoardError("protocol", `this CLI speaks protocol ${PROTOCOL_VERSION}`);
  }
  if (!Array.isArray(record["tasks"])) throw new BoardError("bad_request", ".jev/tasks.json has no tasks array");
  return {
    protocol: PROTOCOL_VERSION,
    tasks: record["tasks"].map((task, index) => parseTask(task, index)),
  };
}

function parseTask(raw: unknown, index: number): Task {
  if (!raw || typeof raw !== "object") throw new BoardError("bad_request", `task ${index} is not an object`);
  const record = raw as Record<string, unknown>;
  const id = requiredString(record["id"], `task ${index} id`);
  if (!/^T[0-9]{3,}$/.test(id)) throw new BoardError("bad_request", `bad task id ${id}`);
  const status = record["status"];
  if (!isStatus(status)) throw new BoardError("bad_request", `${id} has a bad status`);
  const pathsRaw = record["paths"];
  if (!Array.isArray(pathsRaw) || !pathsRaw.every((path) => typeof path === "string")) {
    throw new BoardError("bad_request", `${id} paths must be a string array`);
  }
  const handoffsRaw = record["handoffs"];
  if (!Array.isArray(handoffsRaw) || !handoffsRaw.every((path) => typeof path === "string")) {
    throw new BoardError("bad_request", `${id} handoffs must be a string array`);
  }
  const revision = record["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    throw new BoardError("bad_request", `${id} revision is invalid`);
  }
  const task: Task = {
    id,
    title: requiredString(record["title"], `${id} title`),
    body: typeof record["body"] === "string" ? record["body"] : "",
    status,
    paths: pathsRaw.map((path) => normalizePath(path)),
    revision,
    createdAt: requiredString(record["createdAt"], `${id} createdAt`),
    updatedAt: requiredString(record["updatedAt"], `${id} updatedAt`),
    handoffs: handoffsRaw.map((rel) => {
      assertHandoffRel(id, rel);
      return rel;
    }),
  };
  if (record["claim"] !== undefined) task.claim = parseClaim(record["claim"], id);
  if (record["preferredAgent"] !== undefined) task.preferredAgent = parseAgent(requiredString(record["preferredAgent"], "preferredAgent"));
  if (typeof record["blockedReason"] === "string" && record["blockedReason"]) task.blockedReason = record["blockedReason"];
  if (record["modelHint"] !== undefined) task.modelHint = parseHint(record["modelHint"], id);
  return task;
}

function parseClaim(raw: unknown, id: string): Claim {
  if (!raw || typeof raw !== "object") throw new BoardError("bad_request", `${id} claim is invalid`);
  const record = raw as Record<string, unknown>;
  return {
    agent: parseAgent(requiredString(record["agent"], `${id} claim.agent`)),
    holder: requiredString(record["holder"], `${id} claim.holder`),
    claimedAt: requiredString(record["claimedAt"], `${id} claim.claimedAt`),
    heartbeatAt: requiredString(record["heartbeatAt"], `${id} claim.heartbeatAt`),
    expiresAt: requiredString(record["expiresAt"], `${id} claim.expiresAt`),
  };
}

function parseHint(raw: unknown, id: string): ModelHint {
  if (!raw || typeof raw !== "object") throw new BoardError("bad_request", `${id} modelHint is invalid`);
  const record = raw as Record<string, unknown>;
  const source = record["source"];
  if (source !== "manual" && source !== "jev-model-router") {
    throw new BoardError("bad_request", `${id} modelHint.source is invalid`);
  }
  return modelHintFromParts({
    source,
    ...(typeof record["tier"] === "string" ? { tier: record["tier"] } : {}),
    ...(typeof record["taskKind"] === "string" ? { taskKind: record["taskKind"] } : {}),
    ...(typeof record["modelId"] === "string" ? { modelId: record["modelId"] } : {}),
    ...(typeof record["note"] === "string" ? { note: record["note"] } : {}),
  });
}

function assertHandoffRel(id: string, rel: string): void {
  if (!new RegExp(`^\\.jev/handoffs/${id}/\\d{3,}\\.md$`).test(rel)) {
    throw new BoardError("bad_request", `bad handoff path on ${id}`);
  }
}

function safeHandoff(root: string, id: string, rel: string): string {
  assertHandoffRel(id, rel);
  const full = resolve(root, rel);
  const base = resolve(root, ".jev", "handoffs", id) + sep;
  if (!full.startsWith(base)) throw new BoardError("bad_request", "handoff path escapes the board");
  return full;
}

function isStatus(value: unknown): value is TaskStatus {
  return value === "open" || value === "claimed" || value === "blocked" || value === "done";
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new BoardError("bad_request", `${label} is missing`);
  return value;
}
