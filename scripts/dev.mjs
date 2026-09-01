import { spawn } from "node:child_process";
import { once } from "node:events";

const build = spawn("pnpm", ["build"], { stdio: "inherit" });
const [buildCode] = await once(build, "exit");
if (buildCode !== 0) process.exit(buildCode ?? 1);

const children = [
  spawn("node", ["apps/api/dist/server.js"], { stdio: "inherit", env: process.env }),
  spawn("pnpm", ["--filter", "@libai/web", "dev"], { stdio: "inherit", env: process.env }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exits = children.map(async (child) => {
  const [code, signal] = await once(child, "exit");
  return { code, signal };
});
const result = await Promise.race(exits);
stop();
await Promise.allSettled(exits);
process.exitCode = typeof result.code === "number" ? result.code : result.signal ? 1 : 0;
