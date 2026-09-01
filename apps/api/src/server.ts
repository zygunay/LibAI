import { loadApiConfig } from "@libai/config";
import { MemorySnapshotStore } from "@libai/application";
import { buildApp } from "./app.js";
import { createLiveRecommendationService } from "./live.js";

type ProcessLike = Readonly<{ env: Readonly<Record<string, string | undefined>> }>;
const processLike = (globalThis as typeof globalThis & { process: ProcessLike }).process;
const config = loadApiConfig(processLike.env);
const store = new MemorySnapshotStore();
const service = createLiveRecommendationService({
  store,
  ollamaBaseUrl: config.ollamaBaseUrl,
  ollamaModel: config.ollamaModel,
  ...(config.githubToken ? { githubToken: config.githubToken } : {}),
});
const app = await buildApp({ logger: true, service, store });
await app.listen({ host: "0.0.0.0", port: config.port });
