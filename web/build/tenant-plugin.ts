import type { Plugin } from "vite";
import { adminDevApi } from "./admin-dev-api";
import { loadTenant, sheetUrls } from "./load-tenant";
import { composePage, loadSectionPartials, pageForUrl, renderShell } from "./pages";
import * as render from "./render";

const VIRTUAL_ID = "virtual:tenant";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

/** Only the site template is tenant-rendered (not e.g. admin/index.html). */
const isSiteTemplate = (p: string) => p === "/index.html";

export function tenantPlugin(webRoot: string, slug: string): Plugin {
  let tenant = loadTenant(webRoot, slug);

  return {
    name: "tenant",

    // Reload tenant files on dev-server restart-worthy changes.
    configureServer(server) {
      // /api/admin/* backed by the local tenant files (see functions/ for production).
      server.middlewares.use(adminDevApi(webRoot, slug));

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
      const page = pageForUrl(tenant, ctx.originalUrl ?? "/");
      return composePage(shell, tenant, page, loadSectionPartials(webRoot));
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return;
      const runtime = {
        slug: tenant.config.slug,
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

        const files: Record<string, string> = {
          "robots.txt": render.robotsTxt(tenant),
          "sitemap.xml": render.sitemapXml(tenant),
          "llms.txt": render.llmsTxt(tenant),
        };
        for (const [fileName, source] of Object.entries(files)) {
          this.emitFile({ type: "asset", fileName, source });
        }
      },
    },
  };
}
