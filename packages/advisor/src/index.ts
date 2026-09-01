export type DependencyKind = "dependency" | "devDependency" | "peerDependency";
export type DependencyNode = Readonly<{ name: string; range: string; kind: DependencyKind }>;
export type ProjectContext = Readonly<{
  runtimes: readonly string[];
  frameworks: readonly string[];
  packageManager: string | "unknown";
  moduleFormat: "esm" | "cjs" | "unknown";
}>;
export type AdvisorRisk = Readonly<{
  packageName: string;
  level: "low" | "medium" | "high" | "unknown";
  reason: string;
  source: string;
  assessedAt: string;
}>;
export type AdvisorReport = Readonly<{
  projectName: string;
  context: ProjectContext;
  graph: readonly DependencyNode[];
  optimizations: readonly Readonly<{
    packageName: string;
    action: "keep" | "configure" | "replace";
    reason: string;
    alternative?: string;
    migrationEffort: "none" | "small" | "medium" | "large";
  }>[];
  conflicts: readonly string[];
  risks: readonly AdvisorRisk[];
}>;
type PackageDocument = Readonly<{
  name?: string;
  type?: string;
  packageManager?: string;
  engines?: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
}>;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const RANGE = /^[A-Za-z0-9*^~<>=| .+:/_-]{1,200}$/u;
export function parsePackageJson(input: string, maxBytes = 64 * 1024): PackageDocument {
  if (new TextEncoder().encode(input).length > maxBytes)
    throw new Error("package.json exceeds size limit");
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("package.json is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("package.json must be an object");
  const record = value as Record<string, unknown>;
  for (const dangerous of ["__proto__", "prototype", "constructor"])
    if (Object.hasOwn(record, dangerous)) throw new Error("package.json contains a forbidden key");
  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const)
    validateDependencies(record[field], field);
  return structuredClone(record) as PackageDocument;
}
export function buildDependencyGraph(document: PackageDocument): readonly DependencyNode[] {
  const kinds = [
    ["dependencies", "dependency"],
    ["devDependencies", "devDependency"],
    ["peerDependencies", "peerDependency"],
  ] as const;
  return kinds
    .flatMap(([field, kind]) =>
      Object.entries(document[field] ?? {}).map(([name, range]) => ({ name, range, kind })),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}
export function inferProjectContext(
  document: PackageDocument,
  graph = buildDependencyGraph(document),
): ProjectContext {
  const names = new Set(graph.map((node) => node.name));
  const frameworks = [
    names.has("next") ? "Next.js" : null,
    names.has("react") ? "React" : null,
    names.has("vue") ? "Vue" : null,
    names.has("fastify") ? "Fastify" : null,
  ].filter((item): item is string => item !== null);
  const runtimes = [
    document.engines?.node ? `Node ${document.engines.node}` : null,
    names.has("react-native") ? "React Native" : null,
  ].filter((item): item is string => item !== null);
  return {
    runtimes,
    frameworks,
    packageManager: document.packageManager?.split("@")[0] ?? "unknown",
    moduleFormat:
      document.type === "module" ? "esm" : document.type === "commonjs" ? "cjs" : "unknown",
  };
}
export function findPeerConflicts(graph: readonly DependencyNode[]): readonly string[] {
  const grouped = new Map<string, DependencyNode[]>();
  for (const node of graph) grouped.set(node.name, [...(grouped.get(node.name) ?? []), node]);
  return [...grouped]
    .flatMap(([name, nodes]) => {
      const majors = new Set(
        nodes.map((node) => major(node.range)).filter((value): value is number => value !== null),
      );
      return majors.size > 1
        ? [`${name}: incompatible declared majors ${[...majors].sort().join(", ")}`]
        : [];
    })
    .sort();
}
export function analyzePackageJson(input: string, now = new Date()): AdvisorReport {
  const document = parsePackageJson(input);
  const graph = buildDependencyGraph(document);
  const context = inferProjectContext(document, graph);
  const optimizations = graph
    .filter((node) => node.kind === "dependency")
    .map((node) =>
      node.name === "moment"
        ? {
            packageName: node.name,
            action: "replace" as const,
            reason: "Large legacy date utility; validate native Intl or a focused alternative.",
            alternative: "date-fns",
            migrationEffort: "medium" as const,
          }
        : {
            packageName: node.name,
            action: "keep" as const,
            reason: "No evidence-backed replacement is required from the supplied manifest alone.",
            migrationEffort: "none" as const,
          },
    );
  const risks = graph.map((node) => ({
    packageName: node.name,
    level:
      node.range === "*" || node.range === "latest" ? ("medium" as const) : ("unknown" as const),
    reason:
      node.range === "*" || node.range === "latest"
        ? "Unbounded version range"
        : "Registry security evidence was not supplied",
    source: "package.json",
    assessedAt: now.toISOString(),
  }));
  return {
    projectName: document.name ?? "unnamed-project",
    context,
    graph,
    optimizations,
    conflicts: findPeerConflicts(graph),
    risks,
  };
}
export function deletionReceipt(
  uploadId: string,
  deletedAt: Date,
): Readonly<{ uploadId: string; status: "deleted"; deletedAt: string }> {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(uploadId)) throw new Error("Invalid upload ID");
  return { uploadId, status: "deleted", deletedAt: deletedAt.toISOString() };
}
function validateDependencies(value: unknown, field: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  for (const [name, range] of Object.entries(value as Record<string, unknown>))
    if (!NAME.test(name) || typeof range !== "string" || !RANGE.test(range))
      throw new Error(`Invalid ${field} entry`);
}
function major(range: string): number | null {
  const match = /(?:^|[^0-9])(\d+)(?:\.|$)/u.exec(range);
  return match ? Number(match[1]) : null;
}
