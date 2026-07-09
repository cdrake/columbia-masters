// POST /api/upload-url — mint a one-time Cloudflare Images direct-upload URL.
// The volunteer's browser uploads straight to Cloudflare; the API token stays here.
// Requires Pages env vars: CF_ACCOUNT_ID, CF_IMAGES_API_TOKEN (secret), TENANT.
// The route must be gated by Cloudflare Access (see PROPOSAL_PHOTO_UPLOADS.md).

interface Env {
  CF_ACCOUNT_ID?: string;
  CF_IMAGES_API_TOKEN?: string;
  TENANT?: string;
}

const EVENT_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  if (!env.CF_ACCOUNT_ID || !env.CF_IMAGES_API_TOKEN || !env.TENANT) {
    return json(503, { error: "Photo uploads are not configured for this site yet." });
  }

  let body: { event?: string; caption?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Expected a JSON body." });
  }

  const event = (body.event ?? "").trim();
  const caption = (body.caption ?? "").trim().slice(0, 300);
  if (!EVENT_SLUG.test(event)) {
    return json(400, { error: "event must be a lowercase slug (letters, digits, dashes)." });
  }

  const form = new FormData();
  form.set("requireSignedURLs", "false");
  form.set("metadata", JSON.stringify({ tenant: env.TENANT, event, caption }));

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/images/v2/direct_upload`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.CF_IMAGES_API_TOKEN}` },
      body: form,
    }
  );

  const data = (await res.json()) as {
    success: boolean;
    result?: { id: string; uploadURL: string };
    errors?: { message: string }[];
  };
  if (!res.ok || !data.success || !data.result) {
    console.log("images direct_upload failed", res.status, JSON.stringify(data.errors));
    return json(502, { error: "Could not get an upload URL from Cloudflare Images." });
  }

  return json(200, { id: data.result.id, uploadURL: data.result.uploadURL });
}
