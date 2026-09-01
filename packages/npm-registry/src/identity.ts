import type { NpmPackageVersion, NpmPackument } from "./adapter.js";

export type PackageIdentity = Readonly<{
  repositoryUrl: string | null;
  homepageUrl: string | null;
  github: Readonly<{ owner: string; repository: string }> | null;
}>;

function unwrapUrl(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && value !== null && "url" in value) {
    const url = (value as { url?: unknown }).url;
    return typeof url === "string" ? url.trim() || null : null;
  }
  return null;
}

function normalizeRepository(value: unknown): string | null {
  const raw = unwrapUrl(value);
  if (!raw) return null;
  let candidate = raw.replace(/^git\+/u, "");
  if (/^[\w.-]+@github\.com:/u.test(candidate)) {
    candidate = `https://github.com/${candidate.slice(candidate.indexOf(":") + 1)}`;
  } else if (/^[\w.-]+\/[\w.-]+$/u.test(candidate)) {
    candidate = `https://github.com/${candidate}`;
  } else if (candidate.startsWith("git://github.com/")) {
    candidate = candidate.replace("git://", "https://");
  }
  try {
    const url = new URL(candidate);
    if (url.protocol === "git:" && url.hostname === "github.com") url.protocol = "https:";
    if (url.protocol === "ssh:" && url.hostname === "github.com") {
      url.protocol = "https:";
      url.username = "";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = "https:";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\.git\/?$/u, "").replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function normalizeHomepage(value: unknown): string | null {
  const raw = unwrapUrl(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function extractPackageIdentity(
  packument: NpmPackument,
  version?: NpmPackageVersion,
): PackageIdentity {
  const repositoryUrl = normalizeRepository(version?.repository ?? packument.repository);
  const homepageUrl = normalizeHomepage(version?.homepage ?? packument.homepage);
  let github: PackageIdentity["github"] = null;
  if (repositoryUrl) {
    const url = new URL(repositoryUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.hostname.toLowerCase() === "github.com" && segments.length >= 2) {
      github = { owner: segments[0] as string, repository: segments[1] as string };
    }
  }
  return { repositoryUrl, homepageUrl, github };
}
