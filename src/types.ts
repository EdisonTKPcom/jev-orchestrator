/** Protocol v1 types. The file shape is normative in docs/protocol.md. */

export const PROTOCOL_VERSION = 1 as const;

export const AGENTS = ["cursor", "claude-code", "codex", "devin", "generic"] as const;
export type AgentId = (typeof AGENTS)[number];

export const TASK_STATUSES = ["open", "claimed", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * A record of a model choice made somewhere else.
 * jev-model-router is the sibling that knows how to produce one.
 * This package stores the record. It does not call TypeSafe.
 */
export interface ModelHint {
  source: "manual" | "jev-model-router";
  tier?: string;
  taskKind?: string;
  modelId?: string;
  note?: string;
}

export interface Claim {
  agent: AgentId;
  holder: string;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface Task {
  id: string;
  title: string;
  body: string;
  status: TaskStatus;
  /** Repo-relative paths. A claim locks these against overlapping claims. */
  paths: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Repo-relative handoff markdown paths, oldest first. */
  handoffs: string[];
  claim?: Claim;
  preferredAgent?: AgentId;
  blockedReason?: string;
  modelHint?: ModelHint;
}

export interface BoardFile {
  protocol: typeof PROTOCOL_VERSION;
  tasks: Task[];
}

export interface BoardEvent {
  ts: string;
  type: string;
  task: string;
  agent?: string;
  holder?: string;
  to?: string;
}

export interface PathHold {
  path: string;
  taskId: string;
  title: string;
  agent: AgentId;
  holder: string;
  expiresAt: string;
}
