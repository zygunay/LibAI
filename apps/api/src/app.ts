import swagger from "@fastify/swagger";
import cors from "@fastify/cors";
import { MemorySnapshotStore, RecommendationService, type SnapshotStore } from "@libai/application";
import { analyzePackageJson, deletionReceipt } from "@libai/advisor";
import {
  ApiErrorSchema,
  SearchIntentSchema,
  type ApiError,
  type SearchIntent,
} from "@libai/domain";
import Fastify, { type FastifyInstance } from "fastify";
import { Type } from "typebox";
import { MetricRegistry, SlidingWindowRateLimiter } from "./operations.js";

const HealthSchema = Type.Object(
  {
    status: Type.Literal("ok"),
  },
  { additionalProperties: false },
);

const RecommendationResponseSchema = Type.Object(
  {
    id: Type.String(),
    requestId: Type.String(),
    status: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
    recommendations: Type.Array(Type.Unknown()),
    events: Type.Array(Type.Unknown()),
    createdAt: Type.String(),
    warnings: Type.Array(Type.String()),
    intent: Type.Unknown(),
  },
  { additionalProperties: false },
);
const FeedbackSchema = Type.Object(
  {
    snapshotId: Type.String({ minLength: 1, maxLength: 200 }),
    candidateId: Type.String({ minLength: 1, maxLength: 200 }),
    value: Type.Union([Type.Literal("helpful"), Type.Literal("not-helpful")]),
    idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
const AdvisorSchema = Type.Object(
  { packageJson: Type.String({ minLength: 2, maxLength: 65_536 }) },
  { additionalProperties: false },
);

function errorBody(
  code: ApiError["error"]["code"],
  message: string,
  requestId: string,
  details?: unknown,
): ApiError {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export async function buildApp(
  options: Readonly<{
    service?: RecommendationService;
    store?: SnapshotStore;
    logger?: boolean;
  }> = {},
): Promise<FastifyInstance> {
  const store = options.store ?? new MemorySnapshotStore();
  const metrics = new MetricRegistry();
  const limiter = new SlidingWindowRateLimiter(60, 60_000);
  const service =
    options.service ??
    new RecommendationService({ store, discover: async () => ({ candidates: [] }) });
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: "x-request-id",
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "HEAD", "POST", "DELETE"],
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "LibAI API",
        version: "0.1.0",
      },
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    const budget = limiter.allow(request.ip);
    reply.header("x-ratelimit-remaining", budget.remaining);
    if (!budget.allowed) {
      return reply
        .header("retry-after", Math.ceil(budget.retryAfterMs / 1_000))
        .status(429)
        .send(errorBody("RATE_LIMITED", "Request rate limit exceeded", request.id));
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    metrics.increment("libai_requests_total", {
      route: request.routeOptions.url ?? "unknown",
      status: String(reply.statusCode),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const validation =
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Array.isArray(error.validation)
        ? error.validation
        : undefined;

    if (validation) {
      return reply
        .status(400)
        .send(errorBody("VALIDATION_ERROR", "Request validation failed", request.id, validation));
    }

    request.log.error({ error });
    return reply
      .status(500)
      .send(errorBody("INTERNAL_ERROR", "Unexpected server error", request.id));
  });

  app.get(
    "/health",
    {
      schema: {
        response: { 200: HealthSchema },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get("/metrics", async (_request, reply) =>
    reply.type("text/plain; version=0.0.4").send(metrics.render()),
  );

  app.post(
    "/v1/recommendations",
    {
      schema: {
        body: SearchIntentSchema,
        response: {
          400: ApiErrorSchema,
          200: RecommendationResponseSchema,
        },
      },
    },
    async (request) => service.recommend(request.body as SearchIntent, request.id),
  );

  app.post(
    "/v1/search",
    { schema: { body: SearchIntentSchema, response: { 200: RecommendationResponseSchema } } },
    async (request) => service.recommend(request.body as SearchIntent, request.id),
  );

  app.get(
    "/v1/recommendations/:id",
    {
      schema: {
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 200 }) }),
        response: { 200: RecommendationResponseSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const snapshot = await store.get((request.params as { id: string }).id);
      return (
        snapshot ??
        reply.status(404).send(errorBody("UPSTREAM_ERROR", "Snapshot not found", request.id))
      );
    },
  );

  app.post(
    "/v1/feedback",
    {
      schema: {
        body: FeedbackSchema,
        response: {
          200: Type.Object({ status: Type.Literal("duplicate") }),
          201: Type.Object({ status: Type.Literal("created") }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        snapshotId: string;
        candidateId: string;
        value: "helpful" | "not-helpful";
        idempotencyKey: string;
      };
      const status = await store.saveFeedback({
        ...body,
        createdAt: new Date().toISOString(),
      });
      return reply.status(status === "created" ? 201 : 200).send({ status });
    },
  );

  app.post(
    "/v1/advisor",
    { schema: { body: AdvisorSchema, response: { 200: Type.Unknown() } } },
    async (request) => analyzePackageJson((request.body as { packageJson: string }).packageJson),
  );

  app.delete(
    "/v1/advisor/uploads/:id",
    {
      schema: {
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }),
        response: { 200: Type.Unknown() },
      },
    },
    async (request) => deletionReceipt((request.params as { id: string }).id, new Date()),
  );

  return app;
}
