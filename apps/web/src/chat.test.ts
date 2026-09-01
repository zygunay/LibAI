import { describe, expect, it } from "vitest";
import { MAX_CHAT_QUERY_LENGTH, MIN_CHAT_QUERY_LENGTH, normalizeChatQuery } from "./chat.js";

describe("normalizeChatQuery", () => {
  it("trims a valid natural-language query", () => {
    expect(normalizeChatQuery("  React grafik kütüphanesi  ")).toBe("React grafik kütüphanesi");
  });

  it("rejects empty, whitespace-only and too-short input", () => {
    expect(normalizeChatQuery("")).toBeNull();
    expect(normalizeChatQuery("   ")).toBeNull();
    expect(normalizeChatQuery("ab")).toBeNull();
    expect(normalizeChatQuery("a".repeat(MIN_CHAT_QUERY_LENGTH))).not.toBeNull();
  });

  it("rejects input beyond the product limit", () => {
    expect(normalizeChatQuery("a".repeat(MAX_CHAT_QUERY_LENGTH))).not.toBeNull();
    expect(normalizeChatQuery("a".repeat(MAX_CHAT_QUERY_LENGTH + 1))).toBeNull();
  });
});
