import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { dbPath, resolveSkillarHome } from "../config.js";
import { connectCloud, disconnectCloud, readConnection } from "../sync/cloud-connection.js";
import { prepareCloudSnapshot } from "../sync/cloud-prepare.js";
import { rollbackCloud } from "../sync/cloud-rollback.js";
import { restoreCloud } from "../sync/cloud-restore.js";
import { cloudStatus, pauseCloud, runCloudStep } from "../sync/cloud.js";
import { approveSourceCommands, sourceCommandsEnabled } from "../sync/command-control.js";
import type { Io } from "./serve.js";

export async function runSync(argv: string[], env: NodeJS.ProcessEnv, io: Io): Promise<number> {
  const [command, ...args] = argv;
  const home = resolveSkillarHome(env), source = dbPath(home);
  const out = (value: unknown) => io.out(JSON.stringify(value) + "\n");
  switch (command) {
    case "connect": {
      const { values } = parseArgs({ args, options: {
        "grant-file": { type: "string" }, origin: { type: "string", default: "https://skillar.sh" },
      } });
      if (values["grant-file"] === undefined) throw new Error("sync connect needs --grant-file <path>");
      out(await connectCloud(home, {
        origin: values.origin, grant: readFileSync(values["grant-file"], "utf8").trim(),
      }));
      return 0;
    }
    case "status": {
      parseArgs({ args, options: {} });
      const connection = readConnection(home);
      out({
        connected: connection !== null,
        deviceId: connection?.deviceId ?? null,
        commandsEnabled: sourceCommandsEnabled(home),
        progress: cloudStatus(home),
      });
      return 0;
    }
    case "commands": {
      const { values } = parseArgs({ args, options: {
        enable: { type: "boolean", default: false }, disable: { type: "boolean", default: false },
      } });
      if (values.enable === values.disable) throw new Error("sync commands needs exactly one of --enable or --disable");
      approveSourceCommands(home, values.enable);
      out({ commandsEnabled: sourceCommandsEnabled(home) });
      return 0;
    }
    case "prepare":
      parseArgs({ args, options: {} });
      out(await prepareCloudSnapshot(home, source));
      return 0;
    case "run":
    case "backfill": {
      const { values } = parseArgs({ args, options: {
        resume: { type: "boolean", default: false },
      } });
      out(await runCloudStep(home, source, {
        resume: values.resume, backfill: command === "backfill",
      }));
      return 0;
    }
    case "rollback":
      parseArgs({ args, options: {} });
      out(await rollbackCloud(home));
      return 0;
    case "restore": {
      const { values } = parseArgs({ args, options: {
        destination: { type: "string" }, "source-domain": { type: "string" },
        "snapshot-id": { type: "string" },
      } });
      const connection = readConnection(home);
      if (connection === null) throw new Error("not_connected");
      if (values.destination === undefined || values["source-domain"] === undefined ||
          values["snapshot-id"] === undefined) {
        throw new Error("sync restore needs --destination, --source-domain, and --snapshot-id");
      }
      out(await restoreCloud(home, values.destination, {
        deviceId: connection.deviceId, generation: connection.generation,
        sourceDomain: values["source-domain"], snapshotId: values["snapshot-id"],
      }));
      return 0;
    }
    case "pause":
      parseArgs({ args, options: {} });
      pauseCloud(home);
      out({ paused: true });
      return 0;
    case "disconnect":
      parseArgs({ args, options: {} });
      pauseCloud(home);
      disconnectCloud(home);
      out({ connected: false });
      return 0;
    default:
      throw new Error("sync needs connect, status, commands, prepare, run, backfill, restore, pause, rollback, or disconnect");
  }
}
