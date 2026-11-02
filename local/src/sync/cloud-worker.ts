import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { z } from "zod";
import { atomicCloudJson, cloudHome } from "./cloud-connection.js";
import { runCloudStep } from "./cloud.js";
import { requestRuntimeCapture, runCloudRuntimeStep } from "./cloud-runtime.js";

const { home, source, captureRuntime } = z.strictObject({
  home: z.string(), source: z.string(), captureRuntime: z.boolean().default(false),
}).parse(workerData);
let busy = false, again = false, timer: NodeJS.Timeout | undefined;
const wake = () => {
  if (timer !== undefined) clearTimeout(timer);
  if (busy) { again = true; return; }
  busy = true;
  void runCloudStep(home, source).then(progress =>
    captureRuntime ? runCloudRuntimeStep(home, source, progress,
      request => requestRuntimeCapture(parentPort, request)) : progress,
  ).then(progress => {
    parentPort?.postMessage(progress);
    busy = false;
    if (again || progress.phase === "queued") {
      again = false;
      setImmediate(wake);
      return;
    }
    const delay = progress.phase === "retry" && progress.retryAtMs !== undefined
      ? Math.min(30_000, Math.max(1, progress.retryAtMs - Date.now())) : 30_000;
    timer = setTimeout(wake, delay);
  }).catch(() => {
    // Unexpected failures stop this worker; no token, row, or request body is logged.
    const failed = {
      version: 1, instanceId: "", updatedAtMs: Date.now(), phase: "quarantine",
      code: "worker_failed", attempts: 0, excluded: 0, liveTurns: 0,
    };
    atomicCloudJson(home, "status.json", failed);
    parentPort?.postMessage(failed);
    process.exitCode = 1;
    sourceWatch.close();
    controlWatch.close();
    parentPort?.close();
  });
};
const sourceWatch = watch(dirname(source), (_event, filename) => {
  if (filename === basename(source) || filename === `${basename(source)}-wal`) wake();
});
const controlWatch = watch(cloudHome(home), (_event, filename) => {
  if (filename === "control.json" || filename === "connection.json") wake();
});
parentPort?.on("message", value => { if (value === "wake") wake(); });
wake();
