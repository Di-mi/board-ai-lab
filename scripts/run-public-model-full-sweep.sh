#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRAINING_DIR="${ROOT_DIR}/artifacts/training"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

MODEL_ID="${MODEL_ID:-${1:-}}"

if [[ -z "${MODEL_ID}" ]]; then
  echo "Usage: MODEL_ID=<openrouter-model-id> bash scripts/run-public-model-full-sweep.sh"
  echo "   or: bash scripts/run-public-model-full-sweep.sh <openrouter-model-id>"
  exit 1
fi

ONITAMA_STANDARD_RUN_DIR="${ONITAMA_STANDARD_RUN_DIR:-${TRAINING_DIR}/train-1772783009731}"
ONITAMA_HARD_RUN_DIR="${ONITAMA_HARD_RUN_DIR:-${TRAINING_DIR}/train-1772878297644}"
RUN_ONITAMA_EASY="${RUN_ONITAMA_EASY:-1}"
RUN_ONITAMA_STANDARD="${RUN_ONITAMA_STANDARD:-1}"
RUN_ONITAMA_HARD="${RUN_ONITAMA_HARD:-1}"
RUN_HIVE_EASY="${RUN_HIVE_EASY:-1}"
RUN_HIVE_STANDARD="${RUN_HIVE_STANDARD:-1}"
RUN_HIVE_HARD="${RUN_HIVE_HARD:-1}"

run_bundle() {
  local label="$1"
  shift
  echo ""
  echo "==== ${label}"
  "$@"
}

cd "${ROOT_DIR}"

if [[ "${RUN_ONITAMA_EASY}" == "1" ]]; then
  run_bundle \
    "Onitama easy (${MODEL_ID})" \
    env MODEL_ID="${MODEL_ID}" ONITAMA_OPPONENT="random" SKIP_HIVE=1 EXPORT_PUBLIC_SITE=0 bash ./scripts/run-public-model-benchmarks.sh
fi

if [[ "${RUN_ONITAMA_STANDARD}" == "1" ]]; then
  run_bundle \
    "Onitama standard (${MODEL_ID})" \
    env MODEL_ID="${MODEL_ID}" TRAINING_RUN_DIR="${ONITAMA_STANDARD_RUN_DIR}" ONITAMA_OPPONENT="trained" SKIP_HIVE=1 EXPORT_PUBLIC_SITE=0 bash ./scripts/run-public-model-benchmarks.sh
fi

if [[ "${RUN_ONITAMA_HARD}" == "1" ]]; then
  run_bundle \
    "Onitama hard (${MODEL_ID})" \
    env MODEL_ID="${MODEL_ID}" TRAINING_RUN_DIR="${ONITAMA_HARD_RUN_DIR}" ONITAMA_OPPONENT="trained" SKIP_HIVE=1 EXPORT_PUBLIC_SITE=0 bash ./scripts/run-public-model-benchmarks.sh
fi

if [[ "${RUN_HIVE_EASY}" == "1" ]]; then
  run_bundle \
    "Hive easy (${MODEL_ID})" \
    env MODEL_ID="${MODEL_ID}" HIVE_OPPONENT="random" SKIP_ONITAMA=1 EXPORT_PUBLIC_SITE=0 bash ./scripts/run-public-model-benchmarks.sh
fi

if [[ "${RUN_HIVE_STANDARD}" == "1" ]]; then
  run_bundle \
    "Hive standard (${MODEL_ID})" \
    env MODEL_ID="${MODEL_ID}" HIVE_OPPONENT="medium" SKIP_ONITAMA=1 EXPORT_PUBLIC_SITE=0 bash ./scripts/run-public-model-benchmarks.sh
fi

if [[ "${RUN_HIVE_HARD}" == "1" ]]; then
  run_bundle \
    "Hive hard (${MODEL_ID})" \
    env MODEL_ID="${MODEL_ID}" HIVE_OPPONENT="hard" SKIP_ONITAMA=1 EXPORT_PUBLIC_SITE=0 bash ./scripts/run-public-model-benchmarks.sh
fi

if [[ "${EXPORT_PUBLIC_SITE:-1}" == "1" ]]; then
  echo ""
  echo "==== Export public benchmark data"
  pnpm export-public-site
fi
