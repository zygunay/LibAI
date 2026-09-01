import type { NpmPackageVersion } from "./adapter.js";

export type ModuleSignals = Readonly<{
  types: "bundled" | "unknown";
  typesPath: string | null;
  moduleFormat: "esm" | "cjs" | "dual" | "unknown";
  hasExportsMap: boolean;
}>;

function exportConditions(value: unknown, conditions = new Set<string>()): Set<string> {
  if (typeof value !== "object" || value === null) return conditions;
  for (const [key, child] of Object.entries(value)) {
    if (key === "import" || key === "require") conditions.add(key);
    exportConditions(child, conditions);
  }
  return conditions;
}

export function extractModuleSignals(metadata: NpmPackageVersion): ModuleSignals {
  const typesPath = metadata.types ?? metadata.typings ?? null;
  const conditions = exportConditions(metadata.exports);
  const hasImport =
    conditions.has("import") || Boolean(metadata.module) || metadata.type === "module";
  const hasRequire = conditions.has("require") || metadata.type === "commonjs";
  let moduleFormat: ModuleSignals["moduleFormat"] = "unknown";
  if (hasImport && (hasRequire || (Boolean(metadata.main) && metadata.type !== "module"))) {
    moduleFormat = "dual";
  } else if (hasImport) {
    moduleFormat = "esm";
  } else if (hasRequire || metadata.main) {
    moduleFormat = "cjs";
  }
  return {
    types: typesPath ? "bundled" : "unknown",
    typesPath,
    moduleFormat,
    hasExportsMap: metadata.exports !== undefined,
  };
}
