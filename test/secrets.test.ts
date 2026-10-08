import { describe, expect, it } from "vitest";
import { findSecrets } from "../src/secrets.js";

describe("findSecrets", () => {
  it("flags token shapes and ignores ordinary prose", () => {
    expect(findSecrets("fix the checkout race")).toBeUndefined();
    expect(findSecrets("ask-user to retry")).toBeUndefined();
    expect(findSecrets(`sk-${"a".repeat(20)}`)).toBe("OpenAI-style API key");
    expect(findSecrets("sk-ant-api03-abcdefghij")).toBe("Anthropic API key");
    expect(findSecrets(`ghp_${"a".repeat(20)}`)).toBe("GitHub token");
    expect(findSecrets("AKIAIOSFODNN7EXAMPLE")).toBe("AWS access key id");
  });
});
