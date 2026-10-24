// Dev harness: cross-category recs for a few products, from saved DNA.
import { readFileSync } from "node:fs";
import { Qloo } from "../qloo.ts";
import { catalogEntityTypes, rank, tasteProfile } from "../pipeline/recs.ts";
import type { ProductDNA, SnapshotProduct } from "../types.ts";
const raw = JSON.parse(readFileSync(".cache/woo-products.json", "utf8")) as any[];
const products: SnapshotProduct[] = raw.map((p) => ({ id: String(p.id), sku: p.sku, name: p.name, brand: p.brands?.[0]?.name ?? "", categories: p.categories.map((c: any) => c.name), price: 0, stock: null, description: "" }));
const dna = JSON.parse(readFileSync(".cache/dna.json", "utf8")) as ProductDNA[];
const dnaBy = new Map(dna.map((d) => [d.productId, d]));
const types = catalogEntityTypes(dna);
const q = new Qloo();
const loc = process.argv[2];
for (const name of ["Leather Hiking Boots", "Alan Wake", "Bon Iver", "Pour-Over", "Kånken"]) {
  const p = products.find((x) => x.name.includes(name))!;
  const prof = await tasteProfile(q, [dnaBy.get(p.id)!], { location: loc, entityTypes: types });
  const recs = rank(prof, products, dnaBy, { ids: new Set([p.id]), categories: new Set(p.categories) });
  console.log(`\n${p.name}${loc ? ` @${loc}` : ""}`);
  for (const r of recs) console.log(`   ${r.score.toFixed(2)}  ${products.find((x) => x.id === r.productId)!.name}   (${r.because.join(", ")})`);
}
