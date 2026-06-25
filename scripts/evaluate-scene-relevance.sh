#!/bin/bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

VAULT_ROOT="$HOME/writers"
TOOLS_ROOT="$HOME/writers/obsidianTools"
SCENE_PATH="$VAULT_ROOT/$1"

cd "$TOOLS_ROOT"

node "$TOOLS_ROOT/evaluators/evaluate-scene-metric.mjs" "$SCENE_PATH" Relevance
