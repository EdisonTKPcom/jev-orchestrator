import { randomBytes } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
import { BoardError } from "./errors.js";

/**
 * Same-machine mutex. The nonce stops a slow holder from deleting a lock
 * that a later process already stole.
 */
const STALE_MS = 15_000;

interface LockBody {
  pid: number;
  nonce: string;
  at: string;
}

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const nonce = randomBytes(8).toString("hex");
  const started = Date.now();
  for (;;) {
    let acquired = false;
    try {
      const handle = await open(lockPath, "wx");
      acquired = true;
      try {
        const body: LockBody = { pid: process.pid, nonce, at: new Date().toISOString() };
        await handle.writeFile(JSON.stringify(body));
      } finally {
        await handle.close();
      }
      return await fn();
    } catch (error) {
      if (acquired) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (await lockIsStale(lockPath)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() - started > 5_000) {
        throw new BoardError("busy", "The board is busy. Retry in a moment.");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      if (acquired) await releaseLock(lockPath, nonce);
    }
  }
}

async function lockIsStale(lockPath: string): Promise<boolean> {
  let body: Partial<LockBody> | undefined;
  try {
    body = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockBody>;
  } catch {
    return true;
  }
  let mtime = 0;
  try {
    mtime = (await stat(lockPath)).mtimeMs;
  } catch {
    return true;
  }
  if (Date.now() - mtime > STALE_MS) return true;
  if (typeof body.pid !== "number" || body.pid <= 0) return true;
  if (body.pid === process.pid) return false;
  try {
    process.kill(body.pid, 0);
    return false;
  } catch {
    return true;
  }
}

async function releaseLock(lockPath: string, nonce: string): Promise<void> {
  try {
    const body = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockBody>;
    if (body.nonce === nonce) await rm(lockPath, { force: true });
  } catch {
    /* the lock is already gone */
  }
}
