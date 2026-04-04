import { evaluateHiveGenomeTask } from "./trainer.js";
import type { HiveGenomeEvaluationResult, HiveGenomeEvaluationTask, HiveTrainingProgressEvent } from "./types.js";

const rawTask = process.env.HIVE_WORKER_TASK_JSON;
if (!rawTask) {
  throw new Error("Missing HIVE_WORKER_TASK_JSON for Hive worker.");
}

const task = JSON.parse(rawTask) as HiveGenomeEvaluationTask;

function emit(payload: { kind: "progress"; event: HiveTrainingProgressEvent } | { kind: "result"; result: HiveGenomeEvaluationResult }): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

evaluateHiveGenomeTask(task, (event) => {
  emit({ kind: "progress", event });
})
  .then((result) => {
    emit({ kind: "result", result });
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
