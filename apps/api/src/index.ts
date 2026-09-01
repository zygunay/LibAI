import { defineRuntimeConfig } from "@libai/config";
import { LIBAI_DOMAIN_VERSION } from "@libai/domain";

export const apiRuntime = defineRuntimeConfig({
  service: "api",
  domainVersion: LIBAI_DOMAIN_VERSION,
});

export { buildApp } from "./app.js";
