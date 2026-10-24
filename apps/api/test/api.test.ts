import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyState, type Snapshot } from "@affinity-cart/core";
import { attribution } from "../src/attribution.ts";
import { withinShopperLimit } from "../src/limits.ts";
import { remapBySku } from "../src/store.ts";

const snap = (ids: string[]): Snapshot => ({
  store: { id: "s", name: "S", url: "", currency: "EUR", city: "", country: "" },
  syncedAt: "",
  products: ids.map((id, i) => ({ id, sku: `SKU-${i}`, name: id, brand: "", categories: [], price: 1, stock: 1, description: "" })),
  customers: [],
  orders: [],
});

test("remap: results follow products whose ids changed but SKUs didn't", () => {
  const s = { ...emptyState(), snapshot: snap(["10", "11", "12"]) };
  s.dna = [{ productId: "10", tags: [], interests: [], note: "" }];
  s.recs = { "10": [{ productId: "11", score: 0.9, because: [] }] };
  s.kits = [{ id: "kit-1", productIds: ["10", "11", "12"], score: 0.9, name: "", pitch: "" }];
  assert.equal(remapBySku(s, snap(["110", "111", "112"])), 3);
  assert.equal(s.dna[0].productId, "110");
  assert.deepEqual(Object.keys(s.recs), ["110"]);
  assert.equal(s.recs["110"][0].productId, "111");
  assert.deepEqual(s.kits[0].productIds, ["110", "111", "112"]);
});

test("attribution: only tagged lines count, kit discounts come off, split by source", () => {
  const s = emptyState();
  s.snapshot = snap([]);
  s.snapshot.orders = [
    { id: "1", customer: null, date: "", city: "", country: "", total: 300, discount: 20, items: [
      { productId: "a", qty: 1, total: 100, source: "kit" }, { productId: "b", qty: 1, total: 100, source: "kit" }, { productId: "c", qty: 1, total: 120 } ] },
    { id: "2", customer: null, date: "", city: "", country: "", total: 50, items: [{ productId: "d", qty: 1, total: 50, source: "gift" }] },
    { id: "3", customer: null, date: "", city: "", country: "", total: 80, items: [{ productId: "e", qty: 1, total: 80 }] },
  ];
  const a = attribution(s);
  assert.equal(a.attributed, 230);
  assert.equal(a.attributedOrders, 2);
  assert.deepEqual(a.bySource, { kit: 180, gift: 50 });
  assert.equal(a.revenue, 430);
});

test("limits: one shopper can't hammer the gift finder", () => {
  const who = `t-${Math.random()}`;
  const results = Array.from({ length: 15 }, () => withinShopperLimit(who));
  assert.equal(results.filter(Boolean).length, 12);
  assert.equal(withinShopperLimit(undefined), true);
});
