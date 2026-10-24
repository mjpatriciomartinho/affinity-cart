// Dev harness: profile a few products straight from the local WooCommerce Store API.
import { Qloo } from "../qloo.ts";
import { profileCatalog } from "../pipeline/dna.ts";
import type { SnapshotProduct } from "../types.ts";

const want = process.argv.slice(2);
import { readFileSync } from "node:fs";
// Saved with: curl -L -c jar -b jar "http://127.0.0.1:9400/wp-json/wc/store/v1/products?per_page=100"
const raw = JSON.parse(readFileSync(".cache/woo-products.json", "utf8")) as any[];
const products: SnapshotProduct[] = raw
  .filter((p) => !want.length || want.some((w) => p.name.includes(w)))
  .map((p) => ({
    id: String(p.id), sku: p.sku, name: p.name, brand: p.brands?.[0]?.name ?? "",
    categories: p.categories.map((c: any) => c.name), price: Number(p.prices.price) / 100,
    stock: null, description: p.short_description.replace(/<[^>]+>/g, "").trim(),
  }));
let calls = 0;
const qloo = new Qloo().withListener(() => calls++);
const t0 = Date.now();
const dna = await profileCatalog(qloo, products);
for (const d of dna) {
  const p = products.find((x) => x.id === d.productId)!;
  console.log(`\n${p.name}\n  entity: ${d.entity ? `${d.entity.name} (${d.entity.type})` : "-"}\n  tags:   ${d.tags.map((t) => t.id.replace("urn:tag:", "")).join(", ")}\n  for merchant: ${d.interests.join(", ")}\n  note: ${d.note}`);
}
if (!want.length) (await import("node:fs")).writeFileSync(".cache/dna.json", JSON.stringify(dna, null, 1));
console.log(`\n${dna.length}/${products.length} profiled, ${calls} Qloo calls, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
