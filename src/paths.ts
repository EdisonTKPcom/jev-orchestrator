import { BoardError } from "./errors.js";

/**
 * Prefix matcher used for claim locks.
 * Supported inputs: a relative file, a relative directory, or a directory with a trailing /* or /**.
 * Other globs are rejected so the lock means what it says.
 */
export function normalizePath(input: string): string {
  let path = input.trim().replace(/\\/g, "/");
  if (!path) throw new BoardError("bad_request", "path is empty");
  if (path.includes("\0") || path.includes(":")) {
    throw new BoardError("bad_request", `path is invalid: ${input}`);
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new BoardError("bad_request", `path must be relative: ${input}`);
  }
  path = path.replace(/^\.\//, "").replace(/\/+$/, "");
  if (path.endsWith("/**")) path = path.slice(0, -3);
  else if (path.endsWith("/*")) path = path.slice(0, -2);
  path = path.replace(/\/+$/, "");
  if (!path) path = ".";
  if (path === ".") return ".";
  if (/[*?[\]]/.test(path)) {
    throw new BoardError(
      "bad_request",
      `unsupported glob in ${input}. Use a file, a directory, or a trailing /*`,
    );
  }
  const parts = path.split("/").filter((part) => part !== ".");
  if (parts.includes("..") || parts.includes("")) {
    throw new BoardError("bad_request", `path must stay inside the repo: ${input}`);
  }
  path = parts.join("/");
  if (!path) return ".";
  if (parts[0] === ".jev" || parts[0] === ".git") {
    throw new BoardError("bad_request", `${input} is reserved`);
  }
  if (path.length > 240) throw new BoardError("bad_request", "path is too long");
  return path;
}

export function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  if (left === "." || right === ".") return true;
  if (left === right) return true;
  if (left.startsWith(`${right}/`)) return true;
  if (right.startsWith(`${left}/`)) return true;
  return false;
}
