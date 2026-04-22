#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

MODEL_ID="${MODEL_ID:-${1:-}}"

if [[ -z "${MODEL_ID}" ]]; then
  echo "Usage: MODEL_ID=<openrouter-model-id> bash scripts/run-public-model-benchmarks.sh"
  echo "   or: bash scripts/run-public-model-benchmarks.sh <openrouter-model-id>"
  exit 1
fi

ONITAMA_GAMES="${ONITAMA_GAMES:-${LLM_GAMES:-2}}"
ONITAMA_CONCURRENCY="${ONITAMA_CONCURRENCY:-${LLM_CONCURRENCY:-3}}"
ONITAMA_OPPONENT="${ONITAMA_OPPONENT:-${LLM_OPPONENT:-trained}}"
ONITAMA_DEPTH="${ONITAMA_DEPTH:-${LLM_OPPONENT_DEPTH:-2}}"
ONITAMA_REASONING_EFFORT="${ONITAMA_REASONING_EFFORT:-${LLM_REASONING_EFFORT:-}}"
ONITAMA_REASONING_MAX_TOKENS="${ONITAMA_REASONING_MAX_TOKENS:-${LLM_REASONING_MAX_TOKENS:-}}"

HIVE_GAMES="${HIVE_GAMES:-${HIVE_LLM_GAMES:-4}}"
HIVE_CONCURRENCY="${HIVE_CONCURRENCY:-${HIVE_LLM_CONCURRENCY:-1}}"
HIVE_OPPONENT="${HIVE_OPPONENT:-${HIVE_LLM_OPPONENT:-hard}}"
HIVE_DEPTH="${HIVE_DEPTH:-${HIVE_LLM_OPPONENT_DEPTH:-2}}"
HIVE_MAX_TURNS="${HIVE_MAX_TURNS:-${HIVE_LLM_MAX_TURNS:-100}}"
HIVE_REASONING_EFFORT="${HIVE_REASONING_EFFORT:-${HIVE_LLM_REASONING_EFFORT:-}}"
HIVE_REASONING_MAX_TOKENS="${HIVE_REASONING_MAX_TOKENS:-${HIVE_LLM_REASONING_MAX_TOKENS:-}}"

run_step() {
  local label="$1"
  shift

  echo ""
  echo "==> ${label}"
  printf '    %q' "$@"
  echo ""

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    return 0
  fi

  "$@"
}

cd "${ROOT_DIR}"

if [[ "${SKIP_ONITAMA:-0}" != "1" ]]; then
  run_step \
    "Onitama benchmark for ${MODEL_ID}" \
    env \
    LLM_MODEL="${MODEL_ID}" \
    LLM_GAMES="${ONITAMA_GAMES}" \
    LLM_CONCURRENCY="${ONITAMA_CONCURRENCY}" \
    LLM_OPPONENT="${ONITAMA_OPPONENT}" \
    LLM_OPPONENT_DEPTH="${ONITAMA_DEPTH}" \
    LLM_REASONING_EFFORT="${ONITAMA_REASONING_EFFORT}" \
    LLM_REASONING_MAX_TOKENS="${ONITAMA_REASONING_MAX_TOKENS}" \
    pnpm llm-match
fi

if [[ "${SKIP_HIVE:-0}" != "1" ]]; then
  run_step \
    "Hive benchmark for ${MODEL_ID}" \
    env \
    HIVE_LLM_MODEL="${MODEL_ID}" \
    HIVE_LLM_GAMES="${HIVE_GAMES}" \
    HIVE_LLM_CONCURRENCY="${HIVE_CONCURRENCY}" \
    HIVE_LLM_OPPONENT="${HIVE_OPPONENT}" \
    HIVE_LLM_OPPONENT_DEPTH="${HIVE_DEPTH}" \
    HIVE_LLM_MAX_TURNS="${HIVE_MAX_TURNS}" \
    HIVE_LLM_REASONING_EFFORT="${HIVE_REASONING_EFFORT}" \
    HIVE_LLM_REASONING_MAX_TOKENS="${HIVE_REASONING_MAX_TOKENS}" \
    pnpm hive-llm-match
fi

if [[ "${EXPORT_PUBLIC_SITE:-0}" == "1" ]]; then
  run_step \
    "Export public benchmark data" \
    pnpm export-public-site
fi
