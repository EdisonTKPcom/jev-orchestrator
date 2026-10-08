import { BoardError } from "./errors.js";

const MIN_TTL_MS = 10_000;
const MAX_TTL_MS = 86_400_000;

export function assertTtl(ms: number): void {
  if (!Number.isFinite(ms) || ms < MIN_TTL_MS || ms > MAX_TTL_MS) {
    throw new BoardError("bad_request", "ttl must be between 10s and 24h");
  }
}

/** `30m`, `90s`, `2h`, `1d`. */
export function parseTtl(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) throw new BoardError("bad_request", "ttl must look like 30m, 90s, 2h, or 1d");
  const amount = Number(match[1]);
  const unit = match[2];
  const ms =
    unit === "s" ? amount * 1000 : unit === "m" ? amount * 60_000 : unit === "h" ? amount * 3_600_000 : amount * 86_400_000;
  assertTtl(ms);
  return ms;
}

export function formatRemaining(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 120) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
