// Local stand-in for functions/api/admin/* so `npm run dev` is a full editor:
// same contract (shared/publish.ts), but reads/writes the tenant files on disk
// instead of committing to GitHub. Dev server only — never part of the build.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Connect } from "vite";
import { defaultHomePage, type Page } from "../shared/pages";
import {
  pageFileContent,
  pagePath,
  pagesDir,
  uploadPath,
  validatePublish,
  type AdminState,
  type ApiError,
  type PublishRequest,
  type PublishResult,
} from "../shared/publish";
import { siteFileContent, sitePath, type SiteSettings } from "../shared/site";

function readPageFiles(repoRoot: string, slug: string): Record<string, string> {
  const dir = path.join(repoRoot, pagesDir(slug));
  if (!fs.existsSync(dir)) return {};
  const files: Record<string, string> = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    files[f] = fs.readFileSync(path.join(dir, f), "utf8");
  }
  return files;
}

function readSiteFile(repoRoot: string, slug: string): string | null {
  const file = path.join(repoRoot, sitePath(slug));
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function version(files: Record<string, string>, site: string | null): string {
  const h = crypto.createHash("sha1");
  for (const [name, content] of Object.entries(files)) h.update(`${name}\0${content}\0`);
  if (site !== null) h.update(`site.json\0${site}\0`);
  return h.digest("hex");
}

function send(res: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: Connect.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function adminDevApi(webRoot: string, tenant: string): Connect.NextHandleFunction {
  const repoRoot = path.resolve(webRoot, "..");

  return async (req, res, next) => {
    const url = req.url?.split("?")[0];
    try {
      if (url === "/api/admin/state" && req.method === "GET") {
        const files = readPageFiles(repoRoot, tenant);
        const site = readSiteFile(repoRoot, tenant);
        const pages = Object.values(files).map((c) => JSON.parse(c) as Page);
        const state: AdminState = {
          tenant,
          version: version(files, site),
          pages: pages.length ? pages : [defaultHomePage()],
          site: site === null ? null : (JSON.parse(site) as SiteSettings),
          user: process.env.USER ?? null,
          backend: "dev",
        };
        return send(res, 200, state);
      }

      if (url === "/api/admin/publish" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as PublishRequest;
        const errors = validatePublish(body);
        if (errors.length) return send(res, 400, { error: "Invalid pages", details: errors } satisfies ApiError);

        const before = readPageFiles(repoRoot, tenant);
        const siteBefore = readSiteFile(repoRoot, tenant);
        if (!body.overwrite && body.version !== version(before, siteBefore)) {
          return send(res, 409, { error: "The site changed since you started editing." } satisfies ApiError);
        }

        const dir = path.join(repoRoot, pagesDir(tenant));
        fs.mkdirSync(dir, { recursive: true });
        for (const u of body.uploads ?? []) {
          const file = path.join(repoRoot, uploadPath(tenant, u.name));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.from(u.dataBase64, "base64"));
        }
        const keep = new Set(body.pages.map((p) => `${p.slug}.json`));
        for (const name of Object.keys(before)) {
          if (!keep.has(name)) fs.unlinkSync(path.join(dir, name));
        }
        for (const p of body.pages) {
          const file = path.join(repoRoot, pagePath(tenant, p.slug));
          const content = pageFileContent(p);
          if (before[`${p.slug}.json`] !== content) fs.writeFileSync(file, content);
        }
        if (body.site) {
          const content = siteFileContent(body.site);
          if (content !== siteBefore) fs.writeFileSync(path.join(repoRoot, sitePath(tenant)), content);
        }
        const result: PublishResult = {
          version: version(readPageFiles(repoRoot, tenant), readSiteFile(repoRoot, tenant)),
        };
        return send(res, 200, result);
      }
    } catch (e) {
      return send(res, 500, { error: String(e) } satisfies ApiError);
    }
    next();
  };
}
