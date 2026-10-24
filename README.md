# Affinity Cart

Cultural cross-selling for WooCommerce (Shopify next), built on the [Qloo](https://www.qloo.com/) taste graph and Claude.

Recommendation engines for small shops either need thousands of orders or fall into the mirror effect: buy a kettle, get offered another kettle. Affinity Cart translates a shop's catalog and customers into Qloo's taste graph, so it can recommend across categories from day one: people in Madrid who love Bon Iver also love Fjällräven.

## How it works

The WooCommerce plugin reads the store and the Affinity Cart service runs a five-step pipeline. Every Qloo request is shown in wp-admin, next to the step that made it.

1. **Read your store.** Products, customers and orders via WooCommerce (HPOS-safe). Customers are pseudonymised in PHP: only a salted id, city and purchases leave the site.
2. **Catalog DNA.** A Claude agent maps each product to Qloo: the book, artist or game itself when Qloo knows it, otherwise its brand, plus 3-6 verified interest tags (leather hiking boots → hiking, outdoors, nature).
3. **Customers & tribes.** Each customer becomes a taste vector from what they bought; k-means groups them into tribes; Qloo profiles each tribe's wider culture (brands, artists, films) using their city as a signal.
4. **Ghost catalog.** Brands each tribe over-indexes on that the shop doesn't sell. A scouting agent turns them into sourcing opportunities, with the Qloo evidence.
5. **Recommendations & kits.** For each product, Qloo's cross-domain affinities (entities first, tags for house brands) rank products from other categories; order co-purchase fills thin spots. Results are written to WooCommerce cross-sells and shown on product pages with the reason. A merchandising agent names three-category kits.
6. **Live visitors.** City (CDN geo headers) + products viewed this session → Qloo → a "Picked for you in Berlin" block that updates as they browse.

Items added from the widget carry `_affinity_source` to the order line, which is what revenue attribution counts.

## Layout

```
plugins/woocommerce/affinity-cart   PHP plugin: sync, REST proxy, storefront widget, attribution
apps/admin                          wp-admin React app (builds into the plugin's assets/admin)
apps/api                            Affinity Cart service (Hono)
packages/core                       Qloo client, pipeline steps, agents
playground                          WordPress Playground blueprint + Nordvik demo data
```

## Run it locally

No Docker needed: WordPress + WooCommerce run in [WordPress Playground](https://wordpress.github.io/wordpress-playground/).

```sh
npm install
# .env at the repo root (gitignored): QLOO_API_URL, QLOO_API_KEY. Claude key: ANTHROPIC_API_KEY.
npm run build:admin
npm run dev:api     # http://localhost:8787/v1
npm run dev:wp      # http://127.0.0.1:9400/wp-admin/admin.php?page=affinity-cart
```

The Playground site is rebuilt and re-seeded on every start, so run "Read store" and the steps again. Qloo responses are cached under `.cache/` (gitignored) and never committed.

## License

AGPL-3.0. See [LICENSE](LICENSE).
