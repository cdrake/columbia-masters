// GET /api/content — public, read-only club content (schedule, upcoming events,
// board, FAQ, coaches, notices) as JSON, or markdown with format=md. Reads the
// club's published Google Sheet, falling back per tab to the snapshot baked into
// data/site.json. Response shape and parameters: shared/content.ts.

import { answerContent } from "../../shared/content";
import { liveContent, type Env } from "../../shared/content-function";

type ContentFunction = (ctx: { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void }) => Promise<Response>;

const CORS = { "Access-Control-Allow-Origin": "*" };

export const onRequestGet: ContentFunction = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url);
  try {
    const { content, manifest } = await liveContent(env, url.origin, waitUntil);
    const { status, contentType, body } = answerContent(content, url.searchParams, manifest);
    return new Response(body, {
      status,
      headers: {
        ...CORS,
        "Content-Type": contentType === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
        "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Club content is unavailable right now.", details: [String(e)] }), {
      status: 503,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};

export const onRequestOptions: ContentFunction = async () =>
  new Response(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
