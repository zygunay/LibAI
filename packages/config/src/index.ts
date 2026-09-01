export type RuntimeConfig = Readonly<{
  service: "api" | "web";
  domainVersion: string;
}>;

export function defineRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return Object.freeze({ ...config });
}

export type Environment = "development" | "test" | "production";

export type ApiConfig = Readonly<{
  environment: Environment;
  port: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  githubToken?: string;
}>;

export type WebConfig = Readonly<{
  apiBaseUrl: string;
}>;

export class ConfigurationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Invalid configuration: ${variables.join(", ")}`);
    this.name = "ConfigurationError";
    this.variables = Object.freeze([...variables]);
  }
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function validUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function loadApiConfig(source: EnvironmentSource): ApiConfig {
  const invalid: string[] = [];
  const environment = source.NODE_ENV ?? "development";
  if (!(["development", "test", "production"] as const).includes(environment as Environment)) {
    invalid.push("NODE_ENV");
  }

  const port = Number(source.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) invalid.push("PORT");

  const ollamaBaseUrl = source.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  if (!validUrl(ollamaBaseUrl)) invalid.push("OLLAMA_BASE_URL");
  const ollamaModel = source.OLLAMA_MODEL?.trim() || "qwen3:4b-instruct";

  if (environment === "production" && !source.GITHUB_TOKEN) invalid.push("GITHUB_TOKEN");
  if (invalid.length > 0) throw new ConfigurationError(invalid);

  return Object.freeze({
    environment: environment as Environment,
    port,
    ollamaBaseUrl,
    ollamaModel,
    ...(source.GITHUB_TOKEN ? { githubToken: source.GITHUB_TOKEN } : {}),
  });
}

export function loadWebConfig(source: EnvironmentSource): WebConfig {
  const apiBaseUrl = source.PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  if (!validUrl(apiBaseUrl)) throw new ConfigurationError(["PUBLIC_API_BASE_URL"]);
  return Object.freeze({ apiBaseUrl });
}

export function redactConfig(config: ApiConfig): Record<string, unknown> {
  return {
    environment: config.environment,
    port: config.port,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
    githubToken: config.githubToken ? "[REDACTED]" : undefined,
  };
}
