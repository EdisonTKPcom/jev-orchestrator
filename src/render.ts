import type { PathHold, Task } from "./types.js";

export interface HandoffDraft {
  task: Task;
  from: string;
  to: string;
  at: string;
  done: string;
  next: string;
  avoid?: string;
  questions?: string[];
}

/** Markdown the next agent can read without guessing what happened. */
export function renderHandoff(draft: HandoffDraft): string {
  const lines = [
    "---",
    "protocol: 1",
    `task: ${draft.task.id}`,
    `from: ${draft.from}`,
    `to: ${draft.to}`,
    `at: ${draft.at}`,
    `revision: ${draft.task.revision}`,
    "paths:",
    ...draft.task.paths.map((path) => `  - ${path}`),
    "---",
    "",
    `# Handoff ${draft.task.id}`,
    "",
    "## Done",
    "",
    draft.done.trim(),
    "",
    "## Next",
    "",
    draft.next.trim(),
    "",
  ];
  if (draft.avoid?.trim()) {
    lines.push("## Leave this alone", "", draft.avoid.trim(), "");
  }
  if (draft.questions && draft.questions.length > 0) {
    lines.push("## Open questions", "");
    for (const question of draft.questions) lines.push(`- ${question.trim()}`);
    lines.push("");
  }
  const hint = draft.task.modelHint;
  if (hint) {
    lines.push("## Model hint", "");
    lines.push(`- source: ${hint.source}`);
    if (hint.tier) lines.push(`- tier: ${hint.tier}`);
    if (hint.taskKind) lines.push(`- task kind: ${hint.taskKind}`);
    if (hint.modelId) lines.push(`- model id: ${hint.modelId}`);
    if (hint.note) lines.push(`- note: ${hint.note}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderContext(task: Task, latest: string | undefined, holds: PathHold[], now: number): string {
  const lines = [`# ${task.id} ${task.title}`, "", `status: ${task.status}`, `revision: ${task.revision}`];
  lines.push(task.paths.length > 0 ? `paths: ${task.paths.join(", ")}` : "paths: (none, this task locks no files)");
  if (task.preferredAgent) lines.push(`preferred next agent: ${task.preferredAgent}`);
  if (task.claim && (task.status === "claimed" || task.status === "blocked")) {
    const active = Date.parse(task.claim.expiresAt) > now;
    lines.push(
      `holder: ${task.claim.agent} (${task.claim.holder}) ${active ? "until" : "expired at"} ${task.claim.expiresAt}`,
    );
  }
  if (task.blockedReason) lines.push(`blocked: ${task.blockedReason}`);
  if (task.modelHint) {
    const hint = task.modelHint;
    const bits = [hint.source, hint.tier, hint.modelId].filter((bit): bit is string => Boolean(bit));
    lines.push(`model hint: ${bits.join(" ")}`);
  }
  if (task.body.trim()) {
    lines.push("", "## Body", "", task.body.trim());
  }
  lines.push("", "## Other holds on these paths");
  if (holds.length === 0) lines.push("", "none");
  else {
    lines.push("");
    for (const hold of holds) {
      lines.push(`- ${hold.path} held by ${hold.agent} (${hold.holder}) on ${hold.taskId} until ${hold.expiresAt}`);
    }
  }
  lines.push("", "## Latest handoff", "");
  lines.push(latest ?? "No handoff yet.");
  lines.push("");
  return lines.join("\n");
}
