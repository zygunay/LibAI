import { Compile } from "typebox/compile";
import { type Static, Type } from "typebox";

const StrictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

export const ConstraintSchema = StrictObject({
  kind: Type.Enum(["runtime", "framework", "license", "environment", "performance", "feature"]),
  operator: Type.Enum(["required", "preferred", "excluded"]),
  value: Type.String({ minLength: 1, maxLength: 200 }),
});

export const TaskTypeSchema = Type.Enum([
  "create",
  "integrate",
  "transform",
  "validate",
  "automate",
  "observe",
  "test",
  "secure",
  "store",
  "present",
  "analyze",
  "replace",
]);

export const MissingFieldSchema = Type.Enum([
  "task",
  "runtime",
  "framework",
  "license",
  "environment",
  "performance",
]);

export const AmbiguitySchema = StrictObject({
  field: MissingFieldSchema,
  reason: Type.String({ minLength: 1, maxLength: 300 }),
  question: Type.String({ minLength: 1, maxLength: 300 }),
});

export const SearchIntentSchema = StrictObject({
  schemaVersion: Type.Literal("1"),
  query: Type.String({ minLength: 3, maxLength: 2_000 }),
  normalizedQuery: Type.String({ minLength: 3, maxLength: 2_000 }),
  ecosystem: Type.Literal("npm"),
  language: Type.Enum(["tr", "en", "unknown"]),
  taskType: TaskTypeSchema,
  task: Type.String({ minLength: 2, maxLength: 300 }),
  constraints: Type.Array(ConstraintSchema, { maxItems: 50 }),
  clarificationNeeded: Type.Boolean(),
  missingFields: Type.Array(MissingFieldSchema, { uniqueItems: true }),
  ambiguities: Type.Array(AmbiguitySchema, { maxItems: 10 }),
});

export const SearchSourcePlanSchema = StrictObject({
  source: Type.Enum(["npm", "github"]),
  queries: Type.Array(Type.String({ minLength: 2, maxLength: 500 }), {
    minItems: 1,
    maxItems: 10,
  }),
  filters: Type.Record(Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }))),
  limit: Type.Integer({ minimum: 1, maximum: 100 }),
});

export const SearchPlanSchema = StrictObject({
  schemaVersion: Type.Literal("1"),
  intentSchemaVersion: Type.Literal("1"),
  strategy: Type.Literal("deterministic-v1"),
  sources: Type.Array(SearchSourcePlanSchema, { minItems: 2, maxItems: 2 }),
});

export const IntentTelemetryEventSchema = StrictObject({
  schemaVersion: Type.Literal("1"),
  eventType: Type.Enum(["intent.parsed", "search_plan.created"]),
  occurredAt: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T" }),
  requestId: Type.String({ minLength: 1, maxLength: 200 }),
  queryFingerprint: Type.String({ pattern: "^[a-f0-9]{8}$" }),
  language: Type.Enum(["tr", "en", "unknown"]),
  taskType: TaskTypeSchema,
  clarificationNeeded: Type.Boolean(),
  sourceQueryCounts: Type.Optional(
    Type.Record(Type.Enum(["npm", "github"]), Type.Integer({ minimum: 0, maximum: 10 })),
  ),
});

export const EvidenceSchema = StrictObject({
  id: Type.String({ minLength: 1, maxLength: 120 }),
  source: Type.Enum(["npm", "github"]),
  field: Type.String({ minLength: 1, maxLength: 120 }),
  value: Type.Unknown(),
  sourceUrl: Type.String({ pattern: "^https://" }),
  fetchedAt: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T" }),
  transform: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
});

export const CandidateSchema = StrictObject({
  id: Type.String({ minLength: 1, maxLength: 200 }),
  packageName: Type.String({ minLength: 1, maxLength: 214 }),
  version: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  repositoryUrl: Type.Optional(Type.String({ pattern: "^https://" })),
  evidence: Type.Array(EvidenceSchema, { minItems: 1 }),
  warnings: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
});

export const ScoreBreakdownSchema = StrictObject({
  version: Type.String({ minLength: 1, maxLength: 50 }),
  total: Type.Number({ minimum: 0, maximum: 100 }),
  components: Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 100 })),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  evidenceIds: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
});

export const RecommendationSchema = StrictObject({
  candidateId: Type.String({ minLength: 1 }),
  rank: Type.Integer({ minimum: 1 }),
  score: ScoreBreakdownSchema,
  summary: Type.String({ minLength: 1, maxLength: 1_000 }),
  strengths: Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
  tradeoffs: Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
  risks: Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
  evidenceIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
});

export const ApiErrorSchema = StrictObject({
  error: StrictObject({
    code: Type.Enum([
      "VALIDATION_ERROR",
      "NOT_IMPLEMENTED",
      "RATE_LIMITED",
      "UPSTREAM_ERROR",
      "INTERNAL_ERROR",
    ]),
    message: Type.String({ minLength: 1, maxLength: 500 }),
    requestId: Type.String({ minLength: 1, maxLength: 200 }),
    details: Type.Optional(Type.Unknown()),
  }),
});

export type Constraint = Static<typeof ConstraintSchema>;
export type TaskType = Static<typeof TaskTypeSchema>;
export type MissingField = Static<typeof MissingFieldSchema>;
export type Ambiguity = Static<typeof AmbiguitySchema>;
export type SearchIntent = Static<typeof SearchIntentSchema>;
export type SearchSourcePlan = Static<typeof SearchSourcePlanSchema>;
export type SearchPlan = Static<typeof SearchPlanSchema>;
export type IntentTelemetryEvent = Static<typeof IntentTelemetryEventSchema>;
export type Evidence = Static<typeof EvidenceSchema>;
export type Candidate = Static<typeof CandidateSchema>;
export type ScoreBreakdown = Static<typeof ScoreBreakdownSchema>;
export type Recommendation = Static<typeof RecommendationSchema>;
export type ApiError = Static<typeof ApiErrorSchema>;

export const SearchIntentValidator = Compile(SearchIntentSchema);
export const SearchPlanValidator = Compile(SearchPlanSchema);
export const IntentTelemetryEventValidator = Compile(IntentTelemetryEventSchema);
export const CandidateValidator = Compile(CandidateSchema);
export const EvidenceValidator = Compile(EvidenceSchema);
export const ScoreBreakdownValidator = Compile(ScoreBreakdownSchema);
export const RecommendationValidator = Compile(RecommendationSchema);
export const ApiErrorValidator = Compile(ApiErrorSchema);
