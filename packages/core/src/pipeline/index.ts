import type { Qloo, QlooCall } from "../qloo.ts";
import type { GhostItem, Kit, ProductDNA, Rec, Snapshot, Tribe } from "../types.ts";
import { profileCatalog } from "./dna.ts";
import { ghostCandidates, scoutGhostCatalog } from "./ghost.ts";
import { recommendForVisitor, type Visitor } from "./live.ts";
import { nameKits } from "./merchandiser.ts";
import { buildKits, buildRecs } from "./recs.ts";
import { findTribes, profileTribeCulture } from "./tribes.ts";

export type StepId = "dna" | "tribes" | "ghost" | "recs";
export const STEPS: StepId[] = ["dna", "tribes", "ghost", "recs"];

export type StepState = {
  status: "idle" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  progress?: string;
  calls: QlooCall[];
};

export type StoreState = {
  snapshot?: Snapshot;
  steps: Record<StepId, StepState>;
  dna: ProductDNA[];
  tribes: Tribe[];
  ghost: GhostItem[];
  recs: Record<string, Rec[]>;
  kits: Kit[];
  live: { at: string; visitor: Visitor; recs: Rec[]; call?: QlooCall }[];
};

export const emptyState = (): StoreState => ({
  steps: Object.fromEntries(STEPS.map((s) => [s, { status: "idle", calls: [] }])) as unknown as StoreState["steps"],
  dna: [],
  tribes: [],
  ghost: [],
  recs: {},
  kits: [],
  live: [],
});

const MAX_CALLS_KEPT = 300;

/** Runs one step against the store's state, recording every Qloo call it makes. */
export async function runStep(
  qloo: Qloo,
  state: StoreState,
  step: StepId,
  save: () => Promise<void>,
  opts: { full?: boolean } = {},
): Promise<void> {
  const snap = state.snapshot;
  if (!snap) throw new Error("Sync the store first");
  const s: StepState = { status: "running", startedAt: new Date().toISOString(), calls: [] };
  state.steps[step] = s;
  const q = qloo.withListener((c) => {
    if (s.calls.length < MAX_CALLS_KEPT) s.calls.push(c);
  });
  await save();
  try {
    const byId = new Map(snap.products.map((p) => [p.id, p]));
    if (step === "dna") {
      // Incremental by default: only products without DNA (new ones) get profiled.
      const known = new Set(opts.full ? [] : state.dna.map((d) => d.productId));
      if (opts.full) state.dna = [];
      const todo = snap.products.filter((p) => !known.has(p.id));
      state.dna = state.dna.filter((d) => byId.has(d.productId));
      await profileCatalog(q, todo, {
        onSaved: (d) => {
          state.dna.push(d);
          s.progress = `${state.dna.length} of ${snap.products.length} products profiled`;
          void save();
        },
      });
    } else if (step === "tribes") {
      need(state.dna.length, "Catalog DNA");
      const tribes = findTribes(snap, state.dna);
      for (const t of tribes) {
        s.progress = `Asking Qloo about ${t.id}`;
        t.culture = await profileTribeCulture(q, t);
      }
      state.tribes = tribes;
    } else if (step === "ghost") {
      need(state.tribes.length, "Customers & tribes");
      const candidates = ghostCandidates(snap, state.dna, state.tribes);
      s.progress = `Scout is reviewing ${candidates.length} brands`;
      await save();
      const out = await scoutGhostCatalog(snap, state.tribes, candidates, (id) => byId.get(id)?.name ?? id);
      for (const t of state.tribes) {
        const named = out.tribes.find((x) => x.id === t.id);
        if (named) t.name = named.name;
        (t as Tribe & { description?: string }).description = named?.description;
      }
      state.ghost = out.ghost;
    } else if (step === "recs") {
      need(state.dna.length, "Catalog DNA");
      s.progress = "Building a taste profile per product";
      await save();
      state.recs = await buildRecs(q, snap, state.dna);
      s.progress = "Naming kits";
      await save();
      const dnaBy = new Map(state.dna.map((d) => [d.productId, d]));
      state.kits = await nameKits(buildKits(snap, state.recs), byId, dnaBy, snap.store.name);
    }
    s.status = "done";
    s.progress = undefined;
  } catch (e) {
    s.status = "error";
    s.error = (e as Error).message;
  } finally {
    s.finishedAt = new Date().toISOString();
    await save();
  }
}

/** Every step in order, as autopilot does after new orders or products. Stops at the first failure. */
export async function runPipeline(qloo: Qloo, state: StoreState, save: () => Promise<void>): Promise<void> {
  for (const step of STEPS) {
    await runStep(qloo, state, step, save);
    if (state.steps[step].status === "error") return;
  }
}

export async function liveRecs(qloo: Qloo, state: StoreState, visitor: Visitor) {
  if (!state.snapshot || !state.dna.length) return { recs: [] as Rec[], call: undefined };
  let call: QlooCall | undefined;
  const q = qloo.withListener((c) => {
    // Keep the most telling request for the inspector: the brand query, else the first.
    if (!call || c.params["filter.type"] === "urn:entity:brand") call = c;
  });
  const recs = await recommendForVisitor(q, state.snapshot, state.dna, visitor, 4, state.tribes);
  state.live.unshift({ at: new Date().toISOString(), visitor, recs, call });
  state.live = state.live.slice(0, 50);
  return { recs, call };
}

function need(ok: number, step: string) {
  if (!ok) throw new Error(`Run "${step}" first`);
}

export type { Visitor };
