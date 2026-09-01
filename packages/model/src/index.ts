export type ModelHealth = Readonly<{
  available: boolean;
  provider: string;
  model: string | null;
  reason?: string;
}>;
export type GenerateRequest = Readonly<{
  system: string;
  prompt: string;
  schema?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}>;
export type GenerateResult = Readonly<{
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}>;
export interface ModelProvider {
  health(): Promise<ModelHealth>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export class ModelError extends Error {
  constructor(
    readonly code: "UNAVAILABLE" | "TIMEOUT" | "INVALID_RESPONSE",
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelError";
  }
}

export class OllamaProvider implements ModelProvider {
  private readonly baseUrl: URL;
  constructor(
    private readonly options: Readonly<{
      model: string;
      baseUrl?: string;
      timeoutMs?: number;
      fetch?: FetchLike;
    }>,
  ) {
    if (!options.model.trim()) throw new Error("Ollama model is required");
    this.baseUrl = new URL(options.baseUrl ?? "http://127.0.0.1:11434");
    if (!new Set(["127.0.0.1", "localhost"]).has(this.baseUrl.hostname))
      throw new Error("Ollama must use a local endpoint");
  }
  async health(): Promise<ModelHealth> {
    try {
      const response = await this.request("/api/tags", { method: "GET" });
      if (!response.ok)
        return {
          available: false,
          provider: "ollama",
          model: this.options.model,
          reason: `HTTP ${response.status}`,
        };
      const body = (await response.json()) as { models?: { name?: string }[] };
      return {
        available: body.models?.some((item) => item.name === this.options.model) ?? false,
        provider: "ollama",
        model: this.options.model,
        ...(!body.models?.some((item) => item.name === this.options.model)
          ? { reason: "model-not-installed" }
          : {}),
      };
    } catch (error) {
      return {
        available: false,
        provider: "ollama",
        model: this.options.model,
        reason: error instanceof Error ? error.message : "unavailable",
      };
    }
  }
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.request("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        system: request.system,
        prompt: request.prompt,
        stream: false,
        format: request.schema ?? "json",
        options: { temperature: 0, seed: 42 },
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok)
      throw new ModelError(
        "UNAVAILABLE",
        `Ollama returned HTTP ${response.status}`,
        response.status >= 500,
      );
    const body = (await response.json()) as {
      response?: unknown;
      model?: unknown;
      prompt_eval_count?: unknown;
      eval_count?: unknown;
    };
    if (typeof body.response !== "string" || typeof body.model !== "string")
      throw new ModelError("INVALID_RESPONSE", "Ollama returned an invalid response", false);
    return {
      text: body.response,
      model: body.model,
      ...(typeof body.prompt_eval_count === "number"
        ? { promptTokens: body.prompt_eval_count }
        : {}),
      ...(typeof body.eval_count === "number" ? { completionTokens: body.eval_count } : {}),
    };
  }
  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await (this.options.fetch ?? fetch)(new URL(path, this.baseUrl), {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch (cause) {
      throw new ModelError(
        cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError")
          ? "TIMEOUT"
          : "UNAVAILABLE",
        "Ollama request failed",
        true,
        { cause },
      );
    }
  }
}

export function sanitizeUntrustedText(value: string, maxCharacters = 12_000): string {
  const withoutControls = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("");
  const neutralized = withoutControls.replace(
    /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|system)\s+instructions?/giu,
    "[untrusted instruction removed]",
  );
  return neutralized.slice(0, maxCharacters);
}
export function buildBoundedPrompt(
  input: Readonly<{
    task: string;
    candidates: readonly Readonly<{ id: string; evidence: string }>[];
  }>,
  maxCharacters = 20_000,
): string {
  const header = `TASK\n${sanitizeUntrustedText(input.task, 2_000)}\nCANDIDATE_ALLOWLIST\n${input.candidates.map((item) => item.id).join(",")}\nUNTRUSTED_EVIDENCE\n`;
  const evidence = input.candidates
    .map((item) => `[${item.id}] ${sanitizeUntrustedText(item.evidence)}`)
    .join("\n");
  return `${header}${evidence}`.slice(0, maxCharacters);
}
export function validateCandidateIds(
  ids: readonly string[],
  allowed: ReadonlySet<string>,
): readonly string[] {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !allowed.has(id)))
    throw new ModelError(
      "INVALID_RESPONSE",
      "Model referenced a candidate outside the allowlist",
      false,
    );
  return unique;
}
export function validateClaims(
  claims: readonly Readonly<{ text: string; evidenceIds: readonly string[] }>[],
  evidenceIds: ReadonlySet<string>,
): readonly Readonly<{ text: string; evidenceIds: readonly string[] }>[] {
  return claims.filter(
    (claim) =>
      claim.text.trim() &&
      claim.evidenceIds.length > 0 &&
      claim.evidenceIds.every((id) => evidenceIds.has(id)),
  );
}
export async function generateStructured<T>(
  provider: ModelProvider,
  request: GenerateRequest,
  validate: (value: unknown) => value is T,
  attempts = 2,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await provider.generate(request);
      const parsed: unknown = JSON.parse(extractJson(result.text));
      if (!validate(parsed)) throw new Error("schema mismatch");
      return parsed;
    } catch (error) {
      last = error;
    }
  }
  throw new ModelError("INVALID_RESPONSE", "Model did not return valid structured output", false, {
    cause: last,
  });
}
export function deterministicExplanation(
  candidate: Readonly<{
    id: string;
    total: number;
    warnings: readonly string[];
    evidenceIds: readonly string[];
  }>,
): Readonly<{
  candidateId: string;
  summary: string;
  claims: readonly Readonly<{ text: string; evidenceIds: readonly string[] }>[];
  generatedBy: "deterministic-fallback";
}> {
  const evidenceIds = [...candidate.evidenceIds];
  return {
    candidateId: candidate.id,
    summary: `${candidate.id} received a deterministic score of ${candidate.total}/100.`,
    claims: evidenceIds.length
      ? [
          {
            text: candidate.warnings.length
              ? `Warnings: ${candidate.warnings.join(", ")}.`
              : "No scored warnings were observed.",
            evidenceIds,
          },
        ]
      : [],
    generatedBy: "deterministic-fallback",
  };
}
function extractJson(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const start = Math.min(
    ...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0),
  );
  if (!Number.isFinite(start)) return trimmed;
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  return end >= start ? trimmed.slice(start, end + 1) : trimmed;
}
