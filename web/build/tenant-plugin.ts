import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { answer } from "../shared/records";
import { answerContent, buildContent, loadSheetData, openApi, todayIn } from "../shared/content";
import { adminDevApi } from "./admin-dev-api";
import { loadTenant, sheetUrls } from "./load-tenant";
import { clubPages, composePage, loadSectionPartials, pageForUrl, renderShell } from "./pages";
import * as render from "./render";

const VIRTUAL_ID = "virtual:tenant";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

/** Only the site template is tenant-rendered (not e.g. admin/index.html). */
const isSiteTemplate = (p: string) => p === "/index.html";

export function tenantPlugin(webRoot: string, slug: string): Plugin[] {
  let tenant = loadTenant(webRoot, slug);

  // Runs before Vite processes the HTML, so the theme stylesheet link is
  // bundled/hashed; everything else is filled after (see transformIndexHtml below).
  const theme: Plugin = {
    name: "tenant-theme",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!isSiteTemplate(ctx.path)) return html;
        if (!html.includes("<!-- tenant:theme -->")) {
          throw new Error("[tenant] index.html is missing marker <!-- tenant:theme -->");
        }
        return html
          .replace(/^([ \t]*)<!-- tenant:theme -->\n/m, (_, indent: string) => {
            const head = render.themeHead(tenant);
            return head ? `${indent}${head}\n` : "";
          })
          .replace(/<html([^>]*)>/, (_, attrs: string) => `<html${attrs}${render.themeAttrs(tenant)}>`);
      },
    },
  };

  const main: Plugin = {
    name: "tenant",

    // Reload tenant files on dev-server restart-worthy changes.
    configureServer(server) {
      // /api/admin/* backed by the local tenant files (see functions/ for production).
      server.middlewares.use(adminDevApi(webRoot, slug));

      // /api/records from the tenant's data files (see functions/api/records.ts).
      server.middlewares.use("/api/records", (req, res) => {
        const dataDir = path.join(tenant.publicDir, "data");
        const records = JSON.parse(
          fs.readFileSync(path.join(dataDir, `${tenant.config.teamCode}_all_records.json`), "utf8")
        );
        const { status, body } = answer(
          tenant.config.teamCode,
          records,
          new URL(req.url ?? "", "http://dev").searchParams
        );
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      });

      // /api/content, live /llms.txt and /openapi.json (see functions/ for production).
      // Reads the live Sheet like production; falls back to content/fallback/.
      const live = async (params: URLSearchParams) => {
        const m = render.siteManifest(tenant);
        const { data, source } = await loadSheetData(m, async (url) => {
          const res = await fetch(url);
          const type = res.headers.get("content-type") ?? "";
          return res.ok && type.includes("text/csv") ? res.text() : null;
        });
        return answerContent(buildContent(m, data, source, todayIn(m.timeZone)), params, m);
      };
      const send = (res: import("node:http").ServerResponse, status: number, type: string, body: string) => {
        res.statusCode = status;
        res.setHeader("Content-Type", type);
        res.end(body);
      };
      server.middlewares.use("/api/content", (req, res) => {
        live(new URL(req.url ?? "", "http://dev").searchParams).then(
          (r) => send(res, r.status, r.contentType === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8", r.body),
          (e) => send(res, 500, "text/plain", String(e))
        );
      });
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        if (pathname === "/llms.txt") {
          live(new URLSearchParams("format=md")).then(
            (r) => send(res, 200, "text/plain; charset=utf-8", r.body),
            (e) => send(res, 500, "text/plain", String(e))
          );
        } else if (pathname === "/openapi.json") {
          send(res, 200, "application/json; charset=utf-8", JSON.stringify(openApi(render.siteManifest(tenant)), null, 2));
        } else next();
      });

      const sectionsDir = `${webRoot}/build/sections`;
      server.watcher.add([tenant.dir, sectionsDir]);
      server.watcher.on("all", (_event, file) => {
        if (file.startsWith(sectionsDir)) {
          server.ws.send({ type: "full-reload" });
        } else if (file.startsWith(tenant.dir) && !file.startsWith(tenant.publicDir)) {
          try {
            tenant = loadTenant(webRoot, slug);
          } catch (e) {
            // Keep serving the last good tenant; a bad hand edit shouldn't kill the dev server.
            server.config.logger.error(String(e));
            return;
          }
          server.ws.send({ type: "full-reload" });
        }
      });
    },

    // Build: leave page markers in place; generateBundle composes each page
    // from the final (asset-hashed) HTML. Dev: compose the requested page now.
    transformIndexHtml(html, ctx) {
      if (!isSiteTemplate(ctx.path)) return html;
      const shell = renderShell(html, tenant);
      if (!ctx.server) return shell;
      const { page, scalars } = pageForUrl(tenant, ctx.originalUrl ?? "/");
      return composePage(shell, tenant, page, loadSectionPartials(webRoot), scalars);
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return;
      const runtime = {
        slug: tenant.config.slug,
        kind: tenant.config.kind ?? "club",
        teamCode: tenant.config.teamCode,
        sheetUrls: sheetUrls(tenant.config),
        imageBase: tenant.config.images?.accountHash
          ? `https://imagedelivery.net/${tenant.config.images.accountHash}/`
          : "",
      };
      return `export default ${JSON.stringify(runtime)};`;
    },

    generateBundle: {
      // After vite:build-html has emitted index.html with hashed asset tags.
      order: "post",
      handler(_options, bundle) {
        const index = bundle["index.html"];
        if (index?.type !== "asset") throw new Error("[tenant] index.html missing from bundle");
        const shell = String(index.source);
        const partials = loadSectionPartials(webRoot);
        const [home, ...rest] = tenant.pages;

        index.source = composePage(shell, tenant, home, partials);
        for (const page of rest) {
          this.emitFile({
            type: "asset",
            fileName: `${page.slug}/index.html`,
            source: composePage(shell, tenant, page, partials),
          });
        }
        for (const { page, scalars } of clubPages(tenant)) {
          this.emitFile({
            type: "asset",
            fileName: `${page.slug}/index.html`,
            source: composePage(shell, tenant, page, partials, scalars),
          });
        }

        const files: Record<string, string> = {
          "robots.txt": render.robotsTxt(tenant),
          "sitemap.xml": render.sitemapXml(tenant),
          "llms.txt": render.llmsTxt(tenant),
          "openapi.json": JSON.stringify(openApi(render.siteManifest(tenant)), null, 2) + "\n",
          // Read by functions/api/content.ts and functions/llms.txt.ts.
          "data/site.json": JSON.stringify(render.siteManifest(tenant)) + "\n",
        };
        for (const [fileName, source] of Object.entries(files)) {
          this.emitFile({ type: "asset", fileName, source });
        }
      },
    },
  };

  return [theme, main];
}
