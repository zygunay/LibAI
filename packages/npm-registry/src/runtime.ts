import semver from "semver";

import type { NpmPackageVersion } from "./adapter.js";

export type RuntimeCompatibility = Readonly<{
  engines: Readonly<Record<string, string>>;
  nodeRange: string | null;
  nodeRangeValid: boolean | null;
  targetNodeVersion: string | null;
  compatibility: "compatible" | "incompatible" | "unknown";
}>;

export function extractRuntimeCompatibility(
  metadata: NpmPackageVersion,
  targetNodeVersion?: string,
): RuntimeCompatibility {
  const engines = metadata.engines ?? {};
  const nodeRange = engines.node ?? null;
  if (!nodeRange) {
    return {
      engines,
      nodeRange: null,
      nodeRangeValid: null,
      targetNodeVersion: targetNodeVersion ?? null,
      compatibility: "unknown",
    };
  }
  const validRange = semver.validRange(nodeRange, { loose: true });
  if (!validRange) {
    return {
      engines,
      nodeRange,
      nodeRangeValid: false,
      targetNodeVersion: targetNodeVersion ?? null,
      compatibility: "unknown",
    };
  }
  const target = targetNodeVersion ? semver.valid(targetNodeVersion, { loose: true }) : null;
  return {
    engines,
    nodeRange,
    nodeRangeValid: true,
    targetNodeVersion: targetNodeVersion ?? null,
    compatibility: target
      ? semver.satisfies(target, validRange, { includePrerelease: true })
        ? "compatible"
        : "incompatible"
      : "unknown",
  };
}
