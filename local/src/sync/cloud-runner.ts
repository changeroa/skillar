import { existsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { cloudHome } from "./cloud-connection.js";
import { cloudProgressSchema } from "./cloud.js";

/** No worker or network connection exists until a browser-authorized credential does. */
export function startCloudSync(
  home: string, source: string, log: (message: string) => void,
) {
  let worker: Worker | undefined, controls: FSWatcher | undefined, closed = false;
  let lastPhase: string | undefined;
  const reconcile = () => {
    if (closed) return;
    const directory = cloudHome(home);
    if (controls === undefined && existsSync(directory)) {
      controls = watch(directory, (_event, filename) => {
        if (filename === "connection.json") reconcile();
      });
    }
    if (!existsSync(join(directory, "connection.json"))) {
      if (worker !== undefined) void worker.terminate();
      worker = undefined;
      return;
    }
    if (worker !== undefined) { worker.postMessage("wake"); return; }
    const started = new Worker(new URL("./cloud-worker.js", import.meta.url), {
      workerData: { home, source },
    });
    worker = started;
    started.on("message", value => {
      const progress = cloudProgressSchema.safeParse(value);
      if (progress.success && progress.data.phase !== lastPhase) {
        lastPhase = progress.data.phase;
        log(`cloud sync: ${lastPhase}`);
      }
    });
    started.on("error", () => log("cloud sync: worker_failed"));
    started.on("exit", () => { if (worker === started) worker = undefined; });
  };
  const root = watch(home, (_event, filename) => { if (filename === "cloud") reconcile(); });
  reconcile();
  return {
    close() {
      closed = true;
      root.close();
      controls?.close();
      if (worker !== undefined) void worker.terminate();
      worker = undefined;
    },
  };
}
