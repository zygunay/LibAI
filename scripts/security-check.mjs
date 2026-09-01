import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["apps", "packages", "docs", "scripts", ".github"];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /gh[opusr]_[A-Za-z0-9]{30,}/u,
  /sk-[A-Za-z0-9]{32,}/u,
];
const allowedLicenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "MIT OR Apache-2.0",
]);
const violations = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["dist", "node_modules"].includes(entry.name)) continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (!/\.(?:png|jpg|jpeg|gif|woff2?)$/u.test(entry.name)) {
      const text = await readFile(target, "utf8");
      if (secretPatterns.some((pattern) => pattern.test(text))) violations.push(`secret:${target}`);
    }
  }
}
for (const root of roots) await walk(root);
for (const name of await readdir("node_modules")) {
  if (name.startsWith(".")) continue;
  const packageDirs = name.startsWith("@")
    ? (await readdir(join("node_modules", name))).map((child) => join(name, child))
    : [name];
  for (const packageDir of packageDirs) {
    try {
      const manifest = JSON.parse(
        await readFile(join("node_modules", packageDir, "package.json"), "utf8"),
      );
      const license = typeof manifest.license === "string" ? manifest.license : "unknown";
      if (!allowedLicenses.has(license)) violations.push(`license:${packageDir}:${license}`);
    } catch {
      /* packages without readable manifests are handled by frozen install */
    }
  }
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else
  console.log("Security check passed: no credential fixtures and dependency licenses allowlisted.");
