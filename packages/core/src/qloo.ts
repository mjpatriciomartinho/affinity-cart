import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getKey } from "./secrets.ts";

// Thin Qloo Insights client. Everything Qloo-specific stays behind this file
// so the provider can be swapped after the hackathon.

export type QlooEntity = {
  name: string;
  entity_id: string;
  tag_id?: string; // set instead of entity_id when filter.type is urn:tag
  types?: string[];
  subtype?: string;
  popularity?: number;
  tags?: { id: string; name: string; type: string }[];
  query?: { affinity?: number };
  properties?: { short_description?: string; image?: { url: string } };
};

export type QlooTag = { id: string; name: string; type: string; popularity?: number };

type Params = Record<string, string | number | undefined>;

/** One Qloo request, as shown in the plugin's inspector. */
export type QlooCall = {
  at: string;
  endpoint: string;
  params: Record<string, string>;
  ms: number;
  cached: boolean;
  count: number;
  top: string[];
};

export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

// Dev cache on disk. Gitignored: Qloo response data must never be committed.
export class FileCache implements CacheStore {
  constructor(private dir = path.resolve(process.cwd(), ".cache/qloo-cache")) {}
  private file(key: string) {
    return path.join(this.dir, createHash("sha1").update(key).digest("hex") + ".json");
  }
  async get(key: string) {
    try {
      return JSON.parse(await readFile(this.file(key), "utf8"));
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: unknown) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify(value));
  }
}

// The hackathon key. Not the legacy "qloo.env", which holds a retired key.
const QLOO_SECRETS = "affinity-cart-qloo.env";

// Qloo only accepts "videogame", though some docs say "video_game".
const canonType = (t: string) => (t === "urn:entity:video_game" ? "urn:entity:videogame" : t);

export class Qloo {
  constructor(
    private cache: CacheStore = new FileCache(),
    private onCall?: (call: QlooCall) => void,
    private limiter = { next: 0 },
  ) {}

  /** Same cache and rate limiter, different listener (e.g. per pipeline step). */
  withListener(onCall: (call: QlooCall) => void): Qloo {
    return new Qloo(this.cache, onCall, this.limiter);
  }

  private async get<T>(endpoint: string, params: Params): Promise<T> {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]),
    );
    const qs = new URLSearchParams(Object.entries(clean).sort()).toString();
    const key = `${endpoint}?${qs}`;
    const started = Date.now();
    const report = (data: unknown, cached: boolean) => {
      if (!this.onCall) return;
      const r = (data as { results?: unknown }).results;
      const list = (Array.isArray(r) ? r : ((r as { entities?: unknown[]; tags?: unknown[] })?.entities ??
        (r as { tags?: unknown[] })?.tags ?? [])) as { name?: string }[];
      this.onCall({
        at: new Date().toISOString(),
        endpoint,
        params: clean,
        ms: Date.now() - started,
        cached,
        count: list.length,
        top: list.slice(0, 5).map((e) => e.name ?? ""),
      });
    };
    const hit = await this.cache.get(key);
    if (hit !== undefined) {
      report(hit, true);
      return hit as T;
    }

    // Stay well under the 10 req/s limit: reserve a 120 ms slot per request.
    const slot = Math.max(Date.now(), this.limiter.next);
    this.limiter.next = slot + 120;
    if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()));

    const base = await getKey(QLOO_SECRETS, "QLOO_API_URL");
    const apiKey = await getKey(QLOO_SECRETS, "QLOO_API_KEY");
    // Qloo occasionally times out (504) under load; retry transient failures with backoff.
    let res: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      try {
        res = await fetch(`${base}${endpoint}?${qs}`, { headers: { "X-Api-Key": apiKey }, signal: AbortSignal.timeout(25_000) });
      } catch {
        continue; // network error or our own timeout
      }
      if (res.status !== 429 && res.status < 500) break;
    }
    if (!res) throw new Error(`Qloo ${endpoint}: no response after retries`);
    if (!res.ok) throw new Error(`Qloo ${endpoint} ${res.status}: ${(await res.text()).slice(0, 200).replace(/<[^>]+>/g, " ").trim()}`);
    const data = (await res.json()) as T;
    await this.cache.set(key, data);
    report(data, false);
    return data;
  }

  async search(query: string, type: string, take = 5): Promise<QlooEntity[]> {
    const d = await this.get<{ results?: QlooEntity[] }>("/search", { query, types: canonType(type), take });
    return d.results ?? [];
  }

  async tags(query: string, tagType?: string, take = 10): Promise<QlooTag[]> {
    const d = await this.get<{ results?: { tags?: QlooTag[] } }>("/v2/tags", {
      "filter.query": query,
      "filter.tag.types": tagType,
      take,
    });
    return d.results?.tags ?? [];
  }

  /** /v2/insights. `filterType` e.g. urn:entity:brand. Location is free text ("Madrid") or WKT. */
  async insights(opts: {
    filterType: string;
    entities?: string[];
    tags?: string[];
    filterTags?: string[];
    excludeEntities?: string[];
    location?: string;
    take?: number;
  }): Promise<QlooEntity[]> {
    const loc = opts.location;
    const d = await this.get<{ results?: { entities?: QlooEntity[]; tags?: QlooEntity[] } }>("/v2/insights", {
      "filter.type": canonType(opts.filterType),
      "signal.interests.entities": opts.entities?.join(","),
      "signal.interests.tags": opts.tags?.join(","),
      "filter.tags": opts.filterTags?.join(","),
      "filter.exclude.entities": opts.excludeEntities?.join(","),
      ...(loc ? (loc.startsWith("POINT") ? { "signal.location": loc } : { "signal.location.query": loc }) : {}),
      take: opts.take ?? 30,
    });
    return d.results?.entities ?? d.results?.tags ?? [];
  }
}
