import type { AdminState, ApiError, PublishRequest, PublishResult } from "../../shared/publish";

export class ApiFailure extends Error {
  status: number;
  details: string[];
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.details = body.details ?? [];
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiFailure(0, { error: "Network error — check your connection and try again." });
  }
  // Cloudflare Access answers an expired session with a redirect to its login page.
  if (res.redirected || res.status === 401 || res.status === 403) {
    throw new ApiFailure(401, { error: "Your login has expired. Reload the page to sign in again." });
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiFailure(res.status, { error: `Unexpected response from the server (${res.status}).` });
  }
  if (!res.ok) throw new ApiFailure(res.status, body as ApiError);
  return body as T;
}

export const loadState = () => call<AdminState>("/api/admin/state", { cache: "no-store" });

export const publish = (req: PublishRequest) =>
  call<PublishResult>("/api/admin/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
