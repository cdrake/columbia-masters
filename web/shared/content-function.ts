// Pages Functions glue for /api/content and the live /llms.txt: loads the build
// manifest (data/site.json) and the Sheet, with Cloudflare caching so a burst of
// agent traffic costs at most one Sheet fetch per tab per 5 minutes per colo.
// Free-tier note: these only run on their own routes (no root middleware).

import { buildContent, loadSheetData, todayIn, type ClubContent, type SiteManifest } from "./content";

export interface Env {
  /** Static assets of this deployment (Cloudflare Pages binding). */
  ASSETS: { fetch: (input: Request | string) => Promise<Response> };
}

const SHEET_TTL = 300;

// Per-isolate: the manifest only changes with a deploy, which starts new isolates.
let manifest: SiteManifest | null = null;

async function loadManifest(env: Env, origin: string): Promise<SiteManifest> {
  if (manifest) return manifest;
  const res = await env.ASSETS.fetch(`${origin}/data/site.json`);
  if (!res.ok) throw new Error(`data/site.json: HTTP ${res.status}`);
  manifest = (await res.json()) as SiteManifest;
  return manifest;
}

/** A Sheet tab's CSV via the colo cache; null when Google doesn't return CSV. */
async function fetchSheet(url: string, waitUntil: (p: Promise<unknown>) => void): Promise<string | null> {
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const key = new Request(url);
  const hit = await cache?.match(key);
  if (hit) return hit.text();
  const res = await fetch(url, { cf: { cacheTtl: SHEET_TTL, cacheEverything: true } } as RequestInit);
  // An unpublished Sheet answers 200 with an HTML sign-in page; treat that as unavailable.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) return null;
  const text = await res.text();
  if (cache) {
    waitUntil(
      cache.put(key, new Response(text, { headers: { "Content-Type": "text/csv", "Cache-Control": `public, max-age=${SHEET_TTL}` } }))
    );
  }
  return text;
}

export async function liveContent(
  env: Env,
  origin: string,
  waitUntil: (p: Promise<unknown>) => void
): Promise<{ content: ClubContent; manifest: SiteManifest }> {
  const m = await loadManifest(env, origin);
  const { data, source } = await loadSheetData(m, (url) => fetchSheet(url, waitUntil));
  return { content: buildContent(m, data, source, todayIn(m.timeZone)), manifest: m };
}
