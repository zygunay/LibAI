import type { NpmPackument } from "./adapter.js";

export type PackageStatus = Readonly<{
  availability: "active" | "deprecated" | "unpublished" | "unknown";
  deprecated: boolean;
  yankedLike: boolean;
  selectedVersion: string | null;
  message?: string;
}>;

export function assessPackageStatus(
  packument: NpmPackument,
  versionOrTag = "latest",
): PackageStatus {
  if (packument.time?.unpublished) {
    return {
      availability: "unpublished",
      deprecated: false,
      yankedLike: true,
      selectedVersion: null,
      message: "Package is marked as unpublished by npm",
    };
  }
  const selectedVersion = packument["dist-tags"][versionOrTag] ?? versionOrTag;
  const metadata = packument.versions[selectedVersion];
  if (!metadata) {
    return {
      availability: "unknown",
      deprecated: false,
      yankedLike: true,
      selectedVersion,
      message: "Selected tag or version is absent from the packument",
    };
  }
  if (metadata.deprecated) {
    return {
      availability: "deprecated",
      deprecated: true,
      yankedLike: false,
      selectedVersion,
      message: metadata.deprecated,
    };
  }
  return { availability: "active", deprecated: false, yankedLike: false, selectedVersion };
}
