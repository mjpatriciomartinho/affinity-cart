import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  CO_PURCHASE_REASON,
  liveRecs,
  runGiftConcierge,
  STEPS,
  type GiftRequest,
  type Snapshot,
  type StepId,
  type StoreState,
} from "@affinity-cart/core";
import { attribution } from "./attribution.ts";
import { DEMO_KEYS, withinDailyBudget, withinShopperLimit } from "./limits.ts";
import { load, qloo, remapBySku, save, storeId, type Job } from "./store.ts";

// Affinity Cart service API. The WooCommerce plugin authenticates with its
// store key; everything the merchant sees in wp-admin comes from here.

const LIVE_BUDGET_MS = 10_000;
// Must match Storefront::KIT_DISCOUNT in the plugin, which applies it in the cart.
const KIT_DISCOUNT = 0.1;

/** How a job gets run: in-process locally, as an async Lambda invocation on AWS. */
export type StepRunner = (id: string, job: Job) => Promise<void>;

type Env = { Variables: { id: string; state: StoreState; demo: boolean } };

export function createApp(startStep: StepRunner) {
  const app = new Hono<Env>().basePath("/v1");

  // In WordPress Playground the plugin's PHP runs inside the visitor's browser,
  // so its requests to us are cross-origin.
  app.use("*", cors({ origin: "*", allowHeaders: ["x-affinity-key", "x-shopper-id", "content-type"], allowMethods: ["GET", "POST"] }));

  app.use("*", async (c, next) => {
    const key = c.req.header("x-affinity-key");
    if (!key) return c.json({ error: "Missing X-Affinity-Key header" }, 401);
    const id = storeId(key);
    c.set("id", id);
    c.set("demo", DEMO_KEYS.has(key));
    c.set("state", await load(id));
    await next();
  });

  app.post("/sync", async (c) => {
    const snap = await c.req.json<Snapshot>();
    const s = c.get("state");
    const remapped = remapBySku(s, snap);
    s.snapshot = { ...snap, syncedAt: new Date().toISOString() };
    await save(c.get("id"), s, remapped ? ["snapshot", "results"] : ["snapshot"]);
    return c.json({ ...summary(s), remapped });
  });

  app.get("/state", (c) => c.json(full(c.get("state"))));

  app.post("/steps/:step/run", async (c) => {
    const step = c.req.param("step") as StepId;
    if (!STEPS.includes(step)) return c.json({ error: `Unknown step ${step}` }, 404);
    // Re-profiling the whole catalog is the expensive step; the public demo keeps its results.
    if (step === "dna" && c.get("demo")) return c.json({ error: "Re-profiling the whole catalog is switched off in the public demo. Every other step can run." }, 403);
    if (!(await withinDailyBudget(c.get("id"), c.get("demo"), "run"))) return c.json({ error: "Daily limit for runs reached. Try again tomorrow." }, 429);
    const s = c.get("state");
    if (!s.snapshot) return c.json({ error: "Sync the store first" }, 409);
    const current = s.steps[step];
    // A run that hasn't finished in 15 minutes died with its Lambda; allow a new one.
    const stale = current.startedAt && Date.now() - Date.parse(current.startedAt) > 15 * 60_000;
    if (current.status === "running" && !stale) return c.json({ error: "Already running" }, 409);
    s.steps[step] = { status: "running", startedAt: new Date().toISOString(), progress: "Starting", calls: [] };
    await save(c.get("id"), s, ["results"]);
    await startStep(c.get("id"), step);
    return c.json({ started: step }, 202);
  });

  // Autopilot: every step in order (DNA only for new products).
  app.post("/pipeline/run", async (c) => {
    const s = c.get("state");
    if (!s.snapshot) return c.json({ error: "Sync the store first" }, 409);
    if (!(await withinDailyBudget(c.get("id"), c.get("demo"), "run"))) return c.json({ error: "Daily limit for runs reached. Try again tomorrow." }, 429);
    const busy = STEPS.find((st) => s.steps[st].status === "running" && Date.now() - Date.parse(s.steps[st].startedAt ?? "0") < 15 * 60_000);
    if (busy) return c.json({ error: "Already running" }, 409);
    s.steps.dna = { status: "running", startedAt: new Date().toISOString(), progress: "Starting", calls: [] };
    await save(c.get("id"), s, ["results"]);
    await startStep(c.get("id"), "pipeline");
    return c.json({ started: "pipeline" }, 202);
  });

  // ---- Storefront (called by the plugin on behalf of shoppers) ----

  app.get("/recs/:productId", (c) => {
    const s = c.get("state");
    const pid = c.req.param("productId");
    const d = s.dna.find((x) => x.productId === pid);
    // "about" lets the widget say "Bon Iver fans also love Fjällräven" rather than repeat the brand.
    const about = d?.entity?.name ?? d?.interests[0];
    const byId = new Map(s.snapshot?.products.map((p) => [p.id, p]));
    const kits = s.kits
      .filter((k) => k.productIds.includes(pid))
      .map((k) => ({ ...k, discount: KIT_DISCOUNT, products: k.productIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) }));
    return c.json({ about, recs: decorate(s, s.recs[pid] ?? []), kits });
  });

  app.post("/live", async (c) => {
    const s = c.get("state");
    const { visitor } = await c.req.json<{ visitor: { id: string; city?: string; country?: string; viewed: string[] } }>();
    // Behind CloudFront the visitor's real city arrives as a header.
    const cdnCity = c.req.header("cloudfront-viewer-city");
    if (cdnCity && !visitor.city) visitor.city = decodeURIComponent(cdnCity);
    // Shoppers won't wait on a slow Qloo query: answer within LIVE_BUDGET_MS and let
    // the query finish in the background, so the next page view hits the cache.
    const work = liveRecs(qloo, s, visitor)
      .catch((e: Error) => {
        console.warn("[live]", e.message);
        return { recs: [], call: undefined };
      })
      .finally(() => save(c.get("id"), s, ["live"]).catch(() => {}));
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), LIVE_BUDGET_MS));
    const res = await Promise.race([work, timeout]);
    return c.json(res ? { recs: decorate(s, res.recs), call: res.call } : { recs: [], pending: true });
  });

  app.post("/gift", async (c) => {
    const s = c.get("state");
    if (!s.snapshot || !s.dna.length) return c.json({ error: "The gift finder isn't set up for this shop yet" }, 409);
    // The plugin sends a hashed shopper id (its requests all come from one server);
    // without it, e.g. Playground calling from the browser, fall back to the IP.
    const shopper = c.req.header("x-shopper-id") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();
    if (!withinShopperLimit(shopper)) return c.json({ error: "That's a lot of gift ideas for one hour. Try again a bit later." }, 429);
    if (!(await withinDailyBudget(c.get("id"), c.get("demo"), "gift"))) return c.json({ error: "The gift finder is resting for today. Try again tomorrow." }, 429);
    const req = await c.req.json<GiftRequest>();
    const tastes = (req.tastes ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 5);
    if (!tastes.length) return c.json({ error: "Tell us at least one thing they love" }, 400);
    try {
      const res = await runGiftConcierge(qloo, s.snapshot, s.dna, { ...req, tastes });
      const byId = new Map(s.snapshot.products.map((p) => [p.id, p]));
      return c.json({ ...res, picks: res.picks.map((p) => ({ ...p, product: byId.get(p.productId) })) });
    } catch (e) {
      console.warn("[gift]", (e as Error).message);
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.post("/orders", async (c) => {
    // New orders reported by the plugin after checkout (line items carry the widget source).
    const order = await c.req.json<Snapshot["orders"][number]>();
    const s = c.get("state");
    if (s.snapshot && !s.snapshot.orders.some((o) => o.id === order.id)) s.snapshot.orders.push(order);
    await save(c.get("id"), s, ["snapshot"]);
    return c.json({ ok: true });
  });

  return app;
}

function decorate(s: StoreState, recs: StoreState["recs"][string]) {
  const byId = new Map(s.snapshot?.products.map((p) => [p.id, p]));
  return recs.flatMap((r) => (byId.has(r.productId) ? [{ ...r, product: byId.get(r.productId)! }] : []));
}

function summary(s: StoreState) {
  const snap = s.snapshot;
  return {
    store: snap?.store,
    syncedAt: snap?.syncedAt,
    counts: { products: snap?.products.length ?? 0, customers: snap?.customers.length ?? 0, orders: snap?.orders.length ?? 0 },
    steps: Object.fromEntries(
      STEPS.map((id) => {
        const st = s.steps[id];
        return [id, { status: st.status, progress: st.progress, error: st.error, finishedAt: st.finishedAt, qlooCalls: st.calls.length }];
      }),
    ),
  };
}

function full(s: StoreState) {
  return {
    ...summary(s),
    products: s.snapshot?.products ?? [],
    dna: s.dna,
    tribes: s.tribes,
    ghost: s.ghost,
    recs: s.recs,
    kits: s.kits,
    live: s.live.slice(0, 20),
    calls: Object.fromEntries(STEPS.map((id) => [id, s.steps[id].calls.slice(-60)])),
    attribution: attribution(s),
    coPurchaseReason: CO_PURCHASE_REASON,
  };
}
