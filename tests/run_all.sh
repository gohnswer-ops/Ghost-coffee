#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node --check app.js
node tests/branding_auth.js
node tests/account_auth.js
node tests/e2e.js database.rules.json app.js
node tests/scenario.js database.rules.json
node -e "for (const f of ['database.rules.json','database.schema.json','database.seed.json','firebase.json']) JSON.parse(require('fs').readFileSync(f)); console.log('JSON validation passed')"
