import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
const hiveTrainingDir = path.join(rootDir, "artifacts", "hive-training");

function createRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function main(): Promise<void> {
  const runId = process.env.HIVE_GA_RUN_ID ?? createRunId("hive-train");
  const runDir = path.join(hiveTrainingDir, runId);
  await mkdir(runDir, { recursive: true });

  const shellLogPath = path.join(runDir, "shell.log");
  const pidPath = path.join(runDir, "launcher.json");
  const shellLogHandle = await open(shellLogPath, "a");

  const child = spawn("pnpm", ["hive-train"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HIVE_GA_RUN_ID: runId
    },
    detached: true,
    stdio: ["ignore", shellLogHandle.fd, shellLogHandle.fd]
  });

  child.unref();
  await shellLogHandle.close();

  await writeFile(
    pidPath,
    `${JSON.stringify(
      {
        runId,
        pid: child.pid,
        shellLogPath,
        startedAtIso: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        runId,
        pid: child.pid,
        runDir,
        shellLogPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
