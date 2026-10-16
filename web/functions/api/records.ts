// GET /api/records — public, read-only query over the club's records file, so
// agents and scripts can ask for just the rows they need instead of downloading
// all of /data/<TEAM>_all_records.json. Parameters and matching: shared/records.ts.

import { answer, type TeamRecord } from "../../shared/records";

interface Env {
  /** Static assets of this deployment (Cloudflare Pages binding). */
  ASSETS: { fetch: (input: Request | string) => Promise<Response> };
}

type RecordsFunction = (ctx: { request: Request; env: Env }) => Promise<Response>;

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

// Per-isolate cache; a new deploy starts fresh isolates, so it never outlives the data.
let cache: { team: string; records: TeamRecord[] } | null = null;

async function load(env: Env, origin: string): Promise<{ team: string; records: TeamRecord[] }> {
  if (cache) return cache;
  // data/index.json (written by the Python pipeline) names the team and the records file.
  const indexRes = await env.ASSETS.fetch(`${origin}/data/index.json`);
  if (!indexRes.ok) throw new Error(`data/index.json: HTTP ${indexRes.status}`);
  const index = (await indexRes.json()) as {
    organization?: { teamCode?: string };
    datasets?: { url?: string }[];
  };
  const team = index.organization?.teamCode;
  const url = index.datasets?.[0]?.url;
  if (!team || !url) throw new Error("data/index.json has no teamCode or dataset url");
  const res = await env.ASSETS.fetch(`${origin}${new URL(url, origin).pathname}`);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  cache = { team, records: (await res.json()) as TeamRecord[] };
  return cache;
}

export const onRequestGet: RecordsFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  try {
    const { team, records } = await load(env, url.origin);
    const { status, body } = answer(team, records, url.searchParams);
    return new Response(JSON.stringify(body), { status, headers: HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Records are unavailable right now.", details: [String(e)] }), {
      status: 503,
      headers: { ...HEADERS, "Cache-Control": "no-store" },
    });
  }
};

export const onRequestOptions: RecordsFunction = async () =>
  new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
