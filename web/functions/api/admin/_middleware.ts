// Guards every /api/admin/* route. Cloudflare Access should already block
// unauthenticated requests at the edge; this re-verifies its signed JWT so the
// API stays closed even if the Access application is misconfigured or a
// *.pages.dev hostname is left uncovered.

import { fail, missingConfig, verifyAccess, type AdminFunction } from "./_lib";

export const onRequest: AdminFunction = async ({ request, env, data, next }) => {
  const missing = missingConfig(env);
  if (missing.length) {
    return fail(503, "The site editor isn't set up on this deployment yet.", [`missing settings: ${missing.join(", ")}`]);
  }

  const user = await verifyAccess(request, env);
  if (!user) return fail(401, "Your login has expired. Reload the page to sign in again.");
  data.user = user;

  if (request.method !== "GET") {
    // Cross-site request protection on top of Access' cookie.
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return fail(403, "Cross-origin request refused.");
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
      return fail(415, "Expected a JSON request.");
    }
  }

  try {
    return await next();
  } catch (e) {
    // Surface GitHub/API failures as JSON so the editor can show them.
    return fail(502, "Publishing service error — try again in a minute.", [String((e as Error).message ?? e)]);
  }
};
