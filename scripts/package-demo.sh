#!/bin/sh
# Builds the public WordPress Playground demo: plugin zips + a blueprint that
# installs WooCommerce, seeds Nordvik, connects to the shared demo store and reads it.
#   scripts/package-demo.sh <api-url> <public-base-url>
set -eu
API_URL="$1"     # e.g. https://xxxx.lambda-url.eu-west-1.on.aws/v1
BASE_URL="$2"    # where dist/demo/* will be served from (public, CORS-enabled)
cd "$(dirname "$0")/.."
OUT=dist/demo
rm -rf "$OUT" && mkdir -p "$OUT"
npm run build -w @affinity-cart/admin >/dev/null
(cd plugins/woocommerce && zip -qr "../../$OUT/affinity-cart.zip" affinity-cart -x '*.DS_Store' && zip -qr "../../$OUT/nordvik-demo.zip" nordvik-demo -x '*.DS_Store' -x 'nordvik-demo/gen_seed.py')
# The demo key is public on purpose: every visitor joins the same pre-computed demo store.
python3 - "$API_URL" "$BASE_URL" "$OUT/blueprint.json" <<'PY'
import json, sys
api, base, out = sys.argv[1:]
bp = {
  "$schema": "https://playground.wordpress.net/blueprint-schema.json",
  "landingPage": "/wp-admin/admin.php?page=affinity-cart#dna",
  "preferredVersions": {"php": "8.3", "wp": "latest"},
  "features": {"networking": True},
  "login": True,
  "steps": [
    {"step": "installPlugin", "pluginData": {"resource": "wordpress.org/plugins", "slug": "woocommerce"}, "options": {"activate": True}},
    {"step": "installPlugin", "pluginData": {"resource": "url", "url": f"{base}/affinity-cart.zip"}, "options": {"activate": True}},
    {"step": "installPlugin", "pluginData": {"resource": "url", "url": f"{base}/nordvik-demo.zip"}, "options": {"activate": True}},
    # Options, not wp-config constants: rewriting wp-config breaks Playground's auto-login.
    {"step": "runPHP", "code": "<?php require '/wordpress/wp-load.php'; update_option('affinity_cart_api_url', '" + api + "'); update_option('affinity_cart_key', 'nordvik-public-demo'); update_option('affinity_cart_salt', 'nordvik-demo-salt'); nordvik_demo_seed(); AffinityCart\\Rest::sync();"},
  ],
}
json.dump(bp, open(out, "w"), indent=2)
PY
echo "Built $OUT. Playground link:"
echo "https://playground.wordpress.net/?blueprint-url=$BASE_URL/blueprint.json"
