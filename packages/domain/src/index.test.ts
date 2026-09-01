import { describe, expect, it } from "vitest";

import { LIBAI_DOMAIN_VERSION } from "./index.js";

describe("domain package", () => {
  it("exposes its contract version", () => {
    expect(LIBAI_DOMAIN_VERSION).toBe("0.1.0");
  });
});
