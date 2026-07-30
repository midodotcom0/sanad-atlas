/** Startet lokale API und Next-Oberflaeche als einen beaufsichtigten Prozess. */

import { spawn } from "node:child_process";

const apiPort = process.env.ATLAS_API_PORT ?? "8787";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${apiPort}`;
const childEnv = { ...process.env, ATLAS_API_PORT: apiPort, NEXT_PUBLIC_API_URL: apiUrl };

const api = spawn(process.execPath, ["--experimental-sqlite", "worker/dev-server.mjs"], {
  env: childEnv,
  stdio: "inherit",
});
const web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev"], {
  env: childEnv,
  stdio: "inherit",
});

let stopping = false;
function stop(signal = "SIGTERM", exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (!api.killed) api.kill(signal);
  if (!web.killed) web.kill(signal);
  const timer = setTimeout(() => process.exit(exitCode), 2_000);
  timer.unref();
}

for (const child of [api, web]) {
  child.once("error", (error) => {
    console.error(error.message);
    stop("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) stop(signal ?? "SIGTERM", code ?? 1);
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

