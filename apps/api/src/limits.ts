import { storage } from "./store.ts";

// Spend guards. Gift requests and pipeline runs call Claude and Qloo on our
// account, and the public demo's key is public on purpose, so both are capped.

export const DEMO_KEYS = new Set(["nordvik-public-demo"]);

type Kind = "gift" | "run";
const DAILY: Record<Kind, { demo: number; store: number }> = {
  gift: { demo: 150, store: 1000 },
  run: { demo: 25, store: 200 },
};
const GIFT_PER_SHOPPER_PER_HOUR = 12;

/** Daily per-store budget, persisted so it holds across Lambda instances. */
export async function withinDailyBudget(id: string, demo: boolean, kind: Kind): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `budgets/${id}/${day}.json`;
  const used = (await storage.get<Record<Kind, number>>(key)) ?? { gift: 0, run: 0 };
  const limit = DAILY[kind][demo ? "demo" : "store"];
  if ((used[kind] ?? 0) >= limit) return false;
  // Read-modify-write: two concurrent requests may both pass at the edge of the
  // limit. That's fine for a spend guard; it only needs to stop runaway use.
  await storage.put(key, { ...used, [kind]: (used[kind] ?? 0) + 1 });
  return true;
}

// Best effort, per warm instance: enough to stop one shopper hammering the gift finder.
const hits = new Map<string, number[]>();
export function withinShopperLimit(shopper: string | undefined): boolean {
  if (!shopper) return true;
  const now = Date.now();
  const recent = (hits.get(shopper) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= GIFT_PER_SHOPPER_PER_HOUR) return false;
  recent.push(now);
  hits.set(shopper, recent);
  if (hits.size > 10_000) hits.clear();
  return true;
}
