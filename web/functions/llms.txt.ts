// GET /llms.txt — the club's current information as markdown for AI agents
// (same body as /api/content?format=md). The build also writes a static
// llms.txt from the Sheet snapshot; this Function serves the live version and
// falls back to that static file if anything goes wrong.

import { llmsTxt } from "../shared/content";
import { liveContent, type Env } from "../shared/content-function";

type LlmsFunction = (ctx: {
  request: Request;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
  next: () => Promise<Response>;
}) => Promise<Response>;

export const onRequestGet: LlmsFunction = async ({ request, env, waitUntil, next }) => {
  try {
    const { content, manifest } = await liveContent(env, new URL(request.url).origin, waitUntil);
    return new Response(llmsTxt(manifest, content), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return next();
  }
};
