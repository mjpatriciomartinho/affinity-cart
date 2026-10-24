import assert from "node:assert/strict";
import { test } from "node:test";
import { coPurchase, rank, scoreAgainst, type TasteProfile } from "../src/pipeline/recs.ts";
import { findTribes } from "../src/pipeline/tribes.ts";
import type { ProductDNA, Snapshot, SnapshotProduct } from "../src/types.ts";

const tag = (id: string, name = id) => ({ id: `urn:tag:keyword:qloo:${id}`, name, type: "urn:tag:keyword:qloo" });
const dna = (productId: string, tags: string[], entity?: string): ProductDNA => ({
  productId,
  tags: tags.map((t) => tag(t)),
  entity: entity ? { id: entity, name: entity, type: "urn:entity:brand" } : undefined,
  interests: [],
  note: "",
});
const product = (id: string, category: string, stock: number | null = 10): SnapshotProduct => ({
  id, sku: `SKU-${id}`, name: `P${id}`, brand: "", categories: [category], price: 10, stock, description: "",
});

test("tribes: customers who buy different kinds of things land in different tribes", () => {
  const products = ["1", "2", "3", "4"].map((id) => product(id, "X"));
  const d = [dna("1", ["hiking", "camping"]), dna("2", ["hiking", "nature"]), dna("3", ["horror", "games"]), dna("4", ["horror", "games"])];
  const orders = [
    ...["a", "b", "c"].map((c, i) => ({ id: `o${i}`, customer: c, date: "", city: "Madrid", country: "ES", total: 100, items: [{ productId: "1", qty: 1, total: 50 }, { productId: "2", qty: 1, total: 50 }] })),
    ...["d", "e"].map((c, i) => ({ id: `p${i}`, customer: c, date: "", city: "Berlin", country: "DE", total: 40, items: [{ productId: "3", qty: 1, total: 20 }, { productId: "4", qty: 1, total: 20 }] })),
  ];
  const snap: Snapshot = {
    store: { id: "s", name: "S", url: "", currency: "EUR", city: "Madrid", country: "ES" },
    syncedAt: "", products,
    customers: ["a", "b", "c", "d", "e"].map((id) => ({ id, city: ["d", "e"].includes(id) ? "Berlin" : "Madrid", country: "" })),
    orders,
  };
  const tribes = findTribes(snap, d, 2);
  assert.equal(tribes.length, 2);
  const [big, small] = tribes;
  assert.deepEqual(big.members.sort(), ["a", "b", "c"]);
  assert.deepEqual(small.members.sort(), ["d", "e"]);
  assert.equal(big.cities[0].city, "Madrid");
  assert.ok(big.topTags.some((t) => t.tag.name === "hiking"));
  assert.equal(Math.round((big.share + small.share) * 100), 100);
});

test("scoring: an entity match beats loosely related tags, and reasons are de-duplicated", () => {
  const profile: TasteProfile = {
    entities: new Map([["fjallraven", { id: "fjallraven", name: "Fjällräven", affinity: 0.95 }]]),
    tags: new Map([
      [tag("travel").id, { id: tag("travel").id, name: "Travel", affinity: 0.6 }],
      ["name:travel", { id: "x", name: "travel", affinity: 0.6 }],
    ]),
  };
  const withEntity = scoreAgainst(profile, dna("1", ["travel"], "fjallraven"));
  assert.equal(withEntity.score, 0.95);
  assert.deepEqual(withEntity.because, ["fjallraven", "travel"]);
  const tagsOnly = scoreAgainst(profile, { ...dna("2", ["travel"]), tags: [tag("travel", "Travel"), tag("travel2", "travel")] });
  assert.equal(tagsOnly.because.length, 1, "same reason in two spellings is shown once");
});

test("rank: never recommends the same category, sold-out items or weak matches", () => {
  const profile: TasteProfile = {
    entities: new Map([
      ["a", { id: "a", name: "A", affinity: 0.9 }],
      ["b", { id: "b", name: "B", affinity: 0.9 }],
      ["c", { id: "c", name: "C", affinity: 0.9 }],
      ["d", { id: "d", name: "D", affinity: 0.2 }],
    ]),
    tags: new Map(),
  };
  const products = [product("1", "Bags"), product("2", "Bags"), product("3", "Vinyl", 0), product("4", "Books"), product("5", "Photo")];
  const byId = new Map([dna("2", [], "a"), dna("3", [], "b"), dna("4", [], "c"), dna("5", [], "d")].map((d) => [d.productId, d]));
  const recs = rank(profile, products, byId, { ids: new Set(["1"]), categories: new Set(["Bags"]) });
  assert.deepEqual(recs.map((r) => r.productId), ["4"]);
});

test("co-purchase: needs a real pattern, not one shared customer", () => {
  const order = (id: string, customer: string, items: string[]) => ({ id, customer, date: "", city: "", country: "", total: 0, items: items.map((productId) => ({ productId, qty: 1, total: 0 })) });
  const base = { store: { id: "", name: "", url: "", currency: "", city: "", country: "" }, syncedAt: "", products: [], customers: [] };
  const snap: Snapshot = { ...base, orders: [order("1", "a", ["x", "y"]), order("2", "b", ["x", "y"]), order("3", "c", ["z"]), order("4", "d", ["z", "w"]), order("5", "e", ["w"]), order("6", "f", ["q"])] };
  const together = coPurchase(snap);
  assert.ok(together("x", "y") > 0);
  assert.equal(together("z", "w"), 0, "only one customer bought both");
});
