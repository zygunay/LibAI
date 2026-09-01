import { ApiErrorValidator } from "@libai/domain";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("LibAI API contract", () => {
  it("produces an OpenAPI document", async () => {
    const app = await buildApp();
    apps.push(app);
    await app.ready();

    const document = app.swagger();

    expect(document.info).toMatchObject({ title: "LibAI API", version: "0.1.0" });
    expect(document.paths).toHaveProperty("/health");
    expect(document.paths).toHaveProperty("/v1/recommendations");
  });

  it("returns a standard validation error with the correlation id", async () => {
    const app = await buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      headers: { "x-request-id": "contract-test" },
      payload: { query: "eksik" },
    });
    const body: unknown = response.json();

    expect(response.statusCode).toBe(400);
    expect(response.headers["x-request-id"]).toBe("contract-test");
    expect(ApiErrorValidator.Check(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR", requestId: "contract-test" } });
  });

  it("runs the recommendation pipeline after validation", async () => {
    const app = await buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      payload: {
        schemaVersion: "1",
        query: "Node için logger",
        normalizedQuery: "node için logger",
        ecosystem: "npm",
        language: "tr",
        taskType: "observe",
        task: "structured logging",
        constraints: [],
        clarificationNeeded: false,
        missingFields: [],
        ambiguities: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "complete", recommendations: [] });
  });

  it("accepts local web preflight requests", async () => {
    const app = await buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/search",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("exposes search, snapshot and idempotent feedback contracts", async () => {
    const app = await buildApp();
    apps.push(app);
    await app.ready();
    expect(app.swagger().paths).toHaveProperty("/v1/search");
    expect(app.swagger().paths).toHaveProperty("/v1/recommendations/{id}");
    expect(app.swagger().paths).toHaveProperty("/v1/feedback");
    const payload = {
      snapshotId: "s1",
      candidateId: "c1",
      value: "helpful",
      idempotencyKey: "feedback-1",
    };
    expect((await app.inject({ method: "POST", url: "/v1/feedback", payload })).statusCode).toBe(
      201,
    );
    expect((await app.inject({ method: "POST", url: "/v1/feedback", payload })).statusCode).toBe(
      200,
    );
  });

  it("analyzes and deletes package advisor uploads without retaining file content", async () => {
    const app = await buildApp();
    apps.push(app);
    const analysis = await app.inject({
      method: "POST",
      url: "/v1/advisor",
      payload: { packageJson: JSON.stringify({ name: "demo", dependencies: { react: "^19" } }) },
    });
    expect(analysis.statusCode).toBe(200);
    expect(analysis.json()).toMatchObject({
      projectName: "demo",
      context: { frameworks: ["React"] },
    });
    const deletion = await app.inject({ method: "DELETE", url: "/v1/advisor/uploads/upload_1" });
    expect(deletion.json()).toMatchObject({ uploadId: "upload_1", status: "deleted" });
  });
});
