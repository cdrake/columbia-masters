import type { Plugin } from "vite";
import { loadTenant, sheetUrls, type Tenant } from "./load-tenant";
import * as render from "./render";

const VIRTUAL_ID = "virtual:tenant";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

/** Section blocks replace `<!-- tenant:name -->` markers in index.html. */
function sections(t: Tenant): Record<string, string> {
  return {
    "color-vars": render.colorVars(t),
    "about-text": render.aboutText(t),
    "quick-facts": render.quickFacts(t),
    "schedule-fallback": render.scheduleFallback(t),
    "events-fallback": render.eventsFallback(t),
    classes: render.classesSection(t),
    coaches: render.coachesSection(t),
    "board-fallback": render.boardFallback(t),
    "faq-fallback": render.faqFallback(t),
    "footer-address": render.footerAddress(t),
    "footer-socials": render.footerSocials(t),
    copyright: render.copyright(t),
    "json-ld": render.jsonLd(t),
  };
}

export function tenantPlugin(webRoot: string, slug: string): Plugin {
  let tenant = loadTenant(webRoot, slug);

  return {
    name: "tenant",

    // Reload tenant files on dev-server restart-worthy changes.
    configureServer(server) {
      server.watcher.add(tenant.dir);
      server.watcher.on("change", (file) => {
        if (file.startsWith(tenant.dir) && !file.startsWith(tenant.publicDir)) {
          tenant = loadTenant(webRoot, slug);
          server.ws.send({ type: "full-reload" });
        }
      });
    },

    transformIndexHtml(html) {
      let out = html;

      for (const [name, content] of Object.entries(sections(tenant))) {
        const marker = `<!-- tenant:${name} -->`;
        if (!out.includes(marker)) {
          throw new Error(`[tenant] index.html is missing marker ${marker}`);
        }
        out = out.replace(marker, content);
      }

      out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
        const value = render.scalars(tenant)[key];
        if (value === undefined) {
          throw new Error(`[tenant] index.html references unknown scalar {{ ${key} }}`);
        }
        return value;
      });

      return out;
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

    generateBundle() {
      const files: Record<string, string> = {
        "robots.txt": render.robotsTxt(tenant),
        "sitemap.xml": render.sitemapXml(tenant),
        "llms.txt": render.llmsTxt(tenant),
      };
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}
