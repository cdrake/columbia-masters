// /api/admin contract, shared by the editor, the Vite dev API
// (build/admin-dev-api.ts) and the Cloudflare Pages Functions (functions/api/admin).

import { HOME_SLUG, validatePage, type Page } from "./pages";

/** GET /api/admin/state */
export interface AdminState {
  tenant: string;
  /** Opaque version of the pages dir; echoed back on publish for conflict detection. */
  version: string;
  pages: Page[];
  user: string | null;
  backend: "dev" | "github";
}

export interface PublishUpload {
  /** File name under tenants/<slug>/public/uploads/ (served at /uploads/<name>). */
  name: string;
  dataBase64: string;
}

/** POST /api/admin/publish — the full set of pages; files not listed are deleted. */
export interface PublishRequest {
  version: string;
  /** Skip the conflict check and replace whatever is published. */
  overwrite?: boolean;
  message?: string;
  pages: Page[];
  uploads?: PublishUpload[];
}

export interface PublishResult {
  version: string;
  commitUrl?: string;
}

/** Error body for non-2xx responses. status 409 = someone else published since `version`. */
export interface ApiError {
  error: string;
  details?: string[];
}

export const UPLOAD_NAME_RE = /^[a-z0-9][a-z0-9-]{0,80}\.(jpg|jpeg|png|webp|gif|pdf)$/;
export const MAX_UPLOAD_BYTES = 3_000_000;
// state.ts fetches one blob per page; keep well under Workers' 50-subrequest cap.
export const MAX_PAGES = 30;

export const pagesDir = (tenant: string) => `tenants/${tenant}/content/pages`;
export const pagePath = (tenant: string, slug: string) => `${pagesDir(tenant)}/${slug}.json`;
export const uploadPath = (tenant: string, name: string) => `tenants/${tenant}/public/uploads/${name}`;

export function pageFileContent(page: Page): string {
  return JSON.stringify(page, null, 2) + "\n";
}

const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.match(/=*$/)?.[0].length ?? 0);

/** Validate a publish request body; empty array means OK. */
export function validatePublish(body: unknown): string[] {
  const req = body as PublishRequest;
  if (!req || typeof req !== "object") return ["request body must be JSON"];
  const errs: string[] = [];
  if (typeof req.version !== "string") errs.push("missing version");
  if (!Array.isArray(req.pages)) return [...errs, "pages must be an array"];
  if (req.pages.length > MAX_PAGES) errs.push(`at most ${MAX_PAGES} pages`);

  const slugs = new Set<string>();
  for (const p of req.pages) {
    const label = typeof p?.slug === "string" ? p.slug : "?";
    for (const e of validatePage(p)) errs.push(`page "${label}": ${e}`);
    if (slugs.has(label)) errs.push(`duplicate page slug "${label}"`);
    slugs.add(label);
  }
  if (!slugs.has(HOME_SLUG)) errs.push("the home page is required");

  for (const u of req.uploads ?? []) {
    if (!u || typeof u.name !== "string" || !UPLOAD_NAME_RE.test(u.name)) {
      errs.push(`invalid upload name "${u?.name}"`);
    } else if (typeof u.dataBase64 !== "string" || base64Bytes(u.dataBase64) > MAX_UPLOAD_BYTES) {
      errs.push(`upload "${u.name}" is missing or larger than ${MAX_UPLOAD_BYTES / 1e6} MB`);
    }
  }
  if (req.message !== undefined && typeof req.message !== "string") errs.push("message must be a string");
  return errs;
}

export function commitMessage(tenant: string, req: PublishRequest, user: string | null): string {
  const summary = req.message?.trim().split("\n")[0].slice(0, 72) || "Update pages";
  return `[admin:${tenant}] ${summary}${user ? `\n\nEdited-by: ${user}` : ""}\n`;
}
