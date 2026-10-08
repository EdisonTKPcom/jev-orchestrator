import { BoardError } from "./errors.js";

/**
 * Backstop so a handoff does not become a place tokens get pasted.
 * This is a pattern check, not a guarantee. Callers can bypass it on purpose.
 */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { name: "OpenAI-style API key", re: /sk-[A-Za-z0-9]{20,}/ },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: "bearer token", re: /bearer\s+[A-Za-z0-9\-._~+/]{20,}/i },
];

/** Returns the kind of secret found, or undefined. Never returns the secret itself. */
export function findSecrets(text: string): string | undefined {
  for (const pattern of PATTERNS) {
    if (pattern.re.test(text)) return pattern.name;
  }
  return undefined;
}

export function assertNoSecrets(fields: { field: string; text: string }[], allowSensitive: boolean): void {
  if (allowSensitive) return;
  for (const field of fields) {
    const hit = findSecrets(field.text);
    if (hit) {
      throw new BoardError(
        "sensitive",
        `${field.field} matches a secret pattern (${hit}). Remove it before it is written to the board.`,
      );
    }
  }
}
