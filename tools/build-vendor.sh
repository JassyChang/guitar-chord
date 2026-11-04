#!/bin/sh
# 重新產生 vendor/ 目錄（需先 npm install）。
set -e
cd "$(dirname "$0")/.."
mkdir -p vendor/essentia vendor/basic-pitch-model
cp node_modules/essentia.js/dist/essentia-wasm.es.js node_modules/essentia.js/dist/essentia.js-core.es.js vendor/essentia/
cp node_modules/essentia.js/LICENSE vendor/essentia/LICENSE
cp node_modules/@spotify/basic-pitch/model/* vendor/basic-pitch-model/
npx esbuild tools/basic-pitch-entry.js --bundle --format=esm --minify --platform=browser --outfile=vendor/basic-pitch.js
echo "vendor/ 已更新"
