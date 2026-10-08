import { hostname, userInfo } from "node:os";
import { AGENTS, type AgentId } from "./types.js";
import { BoardError } from "./errors.js";

export function parseAgent(value: string): AgentId {
  const agent = value.trim().toLowerCase();
  if (!(AGENTS as readonly string[]).includes(agent)) {
    throw new BoardError("bad_request", `agent must be one of: ${AGENTS.join(", ")}`);
  }
  return agent as AgentId;
}

export function defaultHolder(): string {
  let user = "user";
  try {
    user = userInfo().username || user;
  } catch {
    /* some sandboxes refuse userInfo */
  }
  let host = "localhost";
  try {
    host = hostname() || host;
  } catch {
    /* ignore */
  }
  return `${user}@${host}`;
}

export function validateHolder(holder: string): void {
  if (!holder || holder.length > 80 || /[\r\n]/.test(holder)) {
    throw new BoardError("bad_request", "holder must be 1 to 80 characters on one line");
  }
}
