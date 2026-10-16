// Shared helpers for the /api/admin Pages Functions: env, JSON responses,
// Cloudflare Access JWT verification and a small GitHub REST client.
// Files starting with "_" are not routes.

import type { Page } from "../../../shared/pages";
import { pagesDir, type ApiError } from "../../../shared/publish";

export interface Env {
  /** Tenant slug; the same Pages variable the build uses. */
  TENANT: string;
  /** Fine-grained PAT with Contents: read & write on this repo only. */
  GITHUB_TOKEN: string;
  /** "owner/repo" */
  GITHUB_REPO: string;
  /** Branch the Pages project deploys from (default "main"). */
  GITHUB_BRANCH?: string;
  /** Zero Trust team name, e.g. "colm" or "colm.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN: string;
  /** Application Audience (AUD) tag of the Access application. */
  ACCESS_AUD: string;
}

export interface Data extends Record<string, unknown> {
  user: string;
}

/** Minimal subset of Cloudflare's PagesFunction types (avoids a workers-types dependency). */
export type AdminFunction = (ctx: {
  request: Request;
  env: Env;
  data: Data;
  next: () => Promise<Response>;
}) => Promise<Response> | Response;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const fail = (status: number, error: string, details?: string[]) =>
  json(status, { error, ...(details ? { details } : {}) } satisfies ApiError);

export function missingConfig(env: Env): string[] {
  const required = ["TENANT", "GITHUB_TOKEN", "GITHUB_REPO", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"] as const;
  return required.filter((k) => !env[k]);
}

// --- Cloudflare Access ---

interface Jwk extends JsonWebKey {
  kid: string;
}

let certCache: { team: string; keys: Jwk[]; expires: number } | null = null;

export function teamOrigin(env: Env): string {
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `https://${team.includes(".") ? team : `${team}.cloudflareaccess.com`}`;
}

async function accessKeys(origin: string, force = false): Promise<Jwk[]> {
  if (!force && certCache && certCache.team === origin && certCache.expires > Date.now()) return certCache.keys;
  const res = await fetch(`${origin}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  certCache = { team: origin, keys, expires: Date.now() + 3600_000 };
  return keys;
}

const b64urlBytes = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) =>
    c.charCodeAt(0)
  );
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/**
 * Verify the Cf-Access-Jwt-Assertion header Access adds to every request it lets through.
 * Returns the signed-in email, or null if the token is missing/invalid.
 */
export async function verifyAccess(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = b64urlJson(h) as { kid?: string; alg?: string };
    const payload = b64urlJson(p) as { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
    if (header.alg !== "RS256") return null;

    const origin = teamOrigin(env);
    let jwk = (await accessKeys(origin)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await accessKeys(origin, true)).find((k) => k.kid === header.kid); // key rotation
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlBytes(s),
      new TextEncoder().encode(`${h}.${p}`)
    );
    if (!ok) return null;

    const now = Date.now() / 1000;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== origin) return null;
    if (!payload.exp || payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 60) return null;
    return payload.email ?? "unknown";
  } catch {
    return null;
  }
}

// --- GitHub ---

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  readonly repo: string;
  readonly branch: string;
  private readonly token: string;

  constructor(env: Env) {
    this.repo = env.GITHUB_REPO;
    this.branch = env.GITHUB_BRANCH || "main";
    this.token = env.GITHUB_TOKEN;
  }

  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "club-site-editor",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async headSha(): Promise<string> {
    const ref = await this.api<{ object: { sha: string } }>("GET", `/git/ref/heads/${this.branch}`);
    return ref.object.sha;
  }

  async treeSha(commitSha: string): Promise<string> {
    return (await this.api<{ tree: { sha: string } }>("GET", `/git/commits/${commitSha}`)).tree.sha;
  }

  /** Page files (name → blob sha) in the tenant's pages dir at a commit. */
  async pageFiles(tenant: string, commitSha: string): Promise<Record<string, string>> {
    try {
      const list = await this.api<{ name: string; sha: string; type: string }[]>(
        "GET",
        `/contents/${pagesDir(tenant)}?ref=${commitSha}`
      );
      const files: Record<string, string> = {};
      for (const f of list) if (f.type === "file" && f.name.endsWith(".json")) files[f.name] = f.sha;
      return files;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return {};
      throw e;
    }
  }

  async blobText(sha: string): Promise<string> {
    const blob = await this.api<{ content: string; encoding: string }>("GET", `/git/blobs/${sha}`);
    const bytes = Uint8Array.from(atob(blob.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async readPages(files: Record<string, string>): Promise<Page[]> {
    return Promise.all(Object.values(files).map(async (sha) => JSON.parse(await this.blobText(sha)) as Page));
  }
}

/** Opaque version of the pages dir: hash of its sorted name:blob-sha list. */
export async function pagesVersion(files: Record<string, string>): Promise<string> {
  const text = Object.keys(files)
    .sort()
    .map((name) => `${name}:${files[name]}`)
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
