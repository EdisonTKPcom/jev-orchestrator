import { describe, expect, it } from "vitest";
import { BoardError } from "../src/errors.js";
import { normalizePath, pathsOverlap } from "../src/paths.js";

describe("paths", () => {
  it("treats a directory as a lock on everything under it", () => {
    expect(pathsOverlap("src", "src/checkout.ts")).toBe(true);
    expect(pathsOverlap("src/**", "src/checkout.ts")).toBe(true);
    expect(pathsOverlap("src/*", "src/a.ts")).toBe(true);
    expect(normalizePath("src/**")).toBe("src");
  });

  it("does not treat a filename as a prefix of a longer name", () => {
    expect(pathsOverlap("src/checkout.ts", "src/checkout.ts.bak")).toBe(false);
  });

  it("rejects escape and reserved paths", () => {
    expect(() => normalizePath("../secret")).toThrow(BoardError);
    expect(() => normalizePath("/etc/passwd")).toThrow(BoardError);
    expect(() => normalizePath(".jev/tasks.json")).toThrow(BoardError);
    expect(() => normalizePath(".git/config")).toThrow(BoardError);
    expect(() => normalizePath("src/**/*.ts")).toThrow(BoardError);
  });

  it("collapses dot segments", () => {
    expect(normalizePath("src/./checkout.ts")).toBe("src/checkout.ts");
    expect(pathsOverlap(".", "src/checkout.ts")).toBe(true);
  });
});
