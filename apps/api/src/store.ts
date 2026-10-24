import { createHash } from "node:crypto";
import { emptyState, Qloo, runPipeline, runStep, type Snapshot, type StepId, type StoreState } from "@affinity-cart/core";
import { storageFromEnv, StorageCache } from "./storage.ts";

// A store's state lives in three parts so writers never clobber each other:
// the API owns the snapshot and the live log; the step runner owns results.
type Part = "snapshot" | "results" | "live";
type Results = Pick<StoreState, "steps" | "dna" | "tribes" | "ghost" | "recs" | "kits">;

export const storage = storageFromEnv();
export const qloo = new Qloo(new StorageCache(storage));

export const storeId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);

export async function load(id: string): Promise<StoreState> {
  const [snapshot, results, live] = await Promise.all([
    storage.get<Snapshot>(`stores/${id}/snapshot.json`),
    storage.get<Results>(`stores/${id}/results.json`),
    storage.get<StoreState["live"]>(`stores/${id}/live.json`),
  ]);
  return { ...emptyState(), ...results, snapshot, live: live ?? [] };
}

export async function save(id: string, s: StoreState, parts: Part[]) {
  const { snapshot, live, steps, dna, tribes, ghost, recs, kits } = s;
  await Promise.all(
    parts.map((p) =>
      p === "snapshot"
        ? storage.put(`stores/${id}/snapshot.json`, snapshot)
        : p === "live"
          ? storage.put(`stores/${id}/live.json`, live)
          : storage.put(`stores/${id}/results.json`, { steps, dna, tribes, ghost, recs, kits }),
    ),
  );
}

export type Job = StepId | "pipeline";

/** Runs a step (or the whole pipeline) to completion, saving results as it goes (the UI polls them). */
export async function runJob(id: string, job: Job) {
  const s = await load(id);
  // Serialise saves so a slow write never lands after a newer one.
  let chain = Promise.resolve();
  const persist = () => (chain = chain.then(() => save(id, s, ["results"])).catch(() => {}));
  if (job === "pipeline") await runPipeline(qloo, s, persist);
  else await runStep(qloo, s, job, persist, { full: true });
  await chain;
}

/**
 * When a store is re-created (a new WordPress Playground, a re-seed), product
 * ids change but SKUs don't. Re-key existing results by SKU so they still apply.
 */
export function remapBySku(s: StoreState, next: Snapshot): number {
  const prev = s.snapshot;
  if (!prev) return 0;
  const bySku = new Map(next.products.filter((p) => p.sku).map((p) => [p.sku, p.id]));
  const map = new Map<string, string>();
  for (const p of prev.products) {
    const id = bySku.get(p.sku);
    if (id && id !== p.id) map.set(p.id, id);
  }
  if (!map.size) return 0;
  const m = (id: string) => map.get(id) ?? id;
  s.dna = s.dna.map((d) => ({ ...d, productId: m(d.productId) }));
  s.recs = Object.fromEntries(
    Object.entries(s.recs).map(([pid, recs]) => [m(pid), recs.map((r) => ({ ...r, productId: m(r.productId) }))]),
  );
  s.kits = s.kits.map((k) => ({ ...k, productIds: k.productIds.map(m) }));
  s.tribes = s.tribes.map((t) => ({ ...t, topProducts: t.topProducts.map(m) }));
  return map.size;
}
