import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  defineRuntimeConfig,
  loadApiConfig,
  loadWebConfig,
  redactConfig,
} from "./index.js";

describe("defineRuntimeConfig", () => {
  it("returns an immutable runtime boundary", () => {
    const config = defineRuntimeConfig({ service: "api", domainVersion: "0.1.0" });

    expect(config).toEqual({ service: "api", domainVersion: "0.1.0" });
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe("environment configuration", () => {
  it("applies safe local defaults and keeps frontend variables separate", () => {
    expect(loadApiConfig({})).toEqual({
      environment: "development",
      port: 3000,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b-instruct",
    });
    expect(loadWebConfig({ PUBLIC_API_BASE_URL: "https://api.libai.dev" })).toEqual({
      apiBaseUrl: "https://api.libai.dev",
    });
  });

  it("reports variable names without leaking their values", () => {
    const secret = "never-print-this-token";
    expect(() =>
      loadApiConfig({ NODE_ENV: "production", PORT: "invalid", GITHUB_TOKEN: secret }),
    ).toThrowError(new ConfigurationError(["PORT"]));

    try {
      loadApiConfig({ NODE_ENV: "production", PORT: "invalid", GITHUB_TOKEN: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("requires the server-only GitHub token in production", () => {
    expect(() => loadApiConfig({ NODE_ENV: "production" })).toThrowError(/GITHUB_TOKEN/);
  });

  it("redacts secrets before configuration is logged", () => {
    const config = loadApiConfig({ GITHUB_TOKEN: "secret" });
    expect(redactConfig(config).githubToken).toBe("[REDACTED]");
  });
});
