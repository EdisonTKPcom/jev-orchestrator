import { BoardError } from "./errors.js";
import type { ModelHint } from "./types.js";

export interface ModelHintParts {
  source: ModelHint["source"];
  tier?: string;
  taskKind?: string;
  modelId?: string;
  note?: string;
}

/**
 * Build a hint to store on a task.
 * Pass `source: "jev-model-router"` when the numbers came from that sibling.
 * This function checks the shape. It does not check that a router was called.
 */
export function modelHintFromParts(parts: ModelHintParts): ModelHint {
  const hint: ModelHint = { source: parts.source };
  const tier = bound(parts.tier, "model tier", 80);
  const taskKind = bound(parts.taskKind, "model task kind", 80);
  const modelId = bound(parts.modelId, "model id", 120);
  const note = bound(parts.note, "model note", 240);
  if (tier !== undefined) hint.tier = tier;
  if (taskKind !== undefined) hint.taskKind = taskKind;
  if (modelId !== undefined) hint.modelId = modelId;
  if (note !== undefined) hint.note = note;
  return hint;
}

function bound(value: string | undefined, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max || /[\r\n]/.test(trimmed)) {
    throw new BoardError("bad_request", `${label} must be 1 to ${max} characters on one line`);
  }
  return trimmed;
}
