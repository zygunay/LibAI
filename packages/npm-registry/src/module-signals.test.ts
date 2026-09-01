import { describe, expect, it } from "vitest";

import { extractModuleSignals } from "./module-signals.js";

describe("TypeScript and module format signals", () => {
  it("detects ESM with bundled TypeScript declarations", () => {
    expect(
      extractModuleSignals({
        name: "esm",
        version: "1.0.0",
        type: "module",
        types: "dist/index.d.ts",
      }),
    ).toEqual({
      types: "bundled",
      typesPath: "dist/index.d.ts",
      moduleFormat: "esm",
      hasExportsMap: false,
    });
  });

  it("distinguishes CJS and conditional dual packages", () => {
    expect(extractModuleSignals({ name: "cjs", version: "1.0.0", main: "index.js" })).toMatchObject(
      {
        moduleFormat: "cjs",
        types: "unknown",
      },
    );
    expect(
      extractModuleSignals({
        name: "dual",
        version: "1.0.0",
        exports: { ".": { import: "./index.mjs", require: "./index.cjs" } },
        typings: "index.d.ts",
      }),
    ).toMatchObject({ moduleFormat: "dual", types: "bundled", hasExportsMap: true });
  });
});
