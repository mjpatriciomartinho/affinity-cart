#!/bin/sh
# Local WooCommerce + Affinity Cart in WordPress Playground (no Docker needed).
cd "$(dirname "$0")/.."
exec npx -y @wp-playground/cli@3.1.60 server --port=9400 --login \
  --blueprint=playground/blueprint.json \
  --mount=plugins/woocommerce/affinity-cart:/wordpress/wp-content/plugins/affinity-cart \
  --mount=plugins/woocommerce/nordvik-demo:/wordpress/wp-content/plugins/nordvik-demo
