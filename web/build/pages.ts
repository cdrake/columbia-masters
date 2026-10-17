import fs from "node:fs";
import path from "node:path";
import type { Tenant } from "./load-tenant";
import * as render from "./render";
import {
  esc,
  HOME_SLUG,
  renderContentBlock,
  SECTION_IDS,
  SECTION_NAV,
  visibleBlocks,
  type Block,
  type Page,
  type SectionId,
} from "../shared/pages";

/** Section partials (web/build/sections/<id>.html), re-read on every call so dev edits apply. */
export function loadSectionPartials(webRoot: string): Record<SectionId, string> {
  const dir = path.join(webRoot, "build", "sections");
  const out = {} as Record<SectionId, string>;
  for (const id of SECTION_IDS) {
    out[id] = fs.readFileSync(path.join(dir, `${id}.html`), "utf8").trimEnd();
  }
  return out;
}

/** Content blocks replace `<!-- tenant:name -->` markers in index.html and section partials. */
function markers(t: Tenant): Record<string, string> {
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
    "footer-resources": render.footerResources(t),
    copyright: render.copyright(t),
    "json-ld": render.jsonLd(t),
  };
}

/**
 * Fill tenant markers and `{{ key }}` scalars in trusted template HTML.
 * `<!-- tenant:page-* -->` markers and `{{ page.* }}` are left for composePage().
 */
function applyTemplate(html: string, t: Tenant, where: string): string {
  let out = html;
  for (const [name, content] of Object.entries(markers(t))) {
    out = out.replaceAll(`<!-- tenant:${name} -->`, () => content);
  }
  const leftover = out.match(/<!-- tenant:(?!page-)([\w-]+) -->/);
  if (leftover) throw new Error(`[tenant] ${where} has unknown marker ${leftover[0]}`);

  const scalars = render.scalars(t);
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = scalars[key];
    if (value === undefined) {
      throw new Error(`[tenant] ${where} references unknown scalar {{ ${key} }}`);
    }
    return value;
  });
}

/** index.html with site-wide markers filled; page markers still pending. */
export function renderShell(html: string, t: Tenant): string {
  for (const m of ["page-nav", "page-body"]) {
    if (!html.includes(`<!-- tenant:${m} -->`)) {
      throw new Error(`[tenant] index.html is missing marker <!-- tenant:${m} -->`);
    }
  }
  return applyTemplate(html, t, "index.html");
}

function navLinks(t: Tenant, page: Page): string {
  const isHome = page.slug === HOME_SLUG;
  const base = isHome ? "" : "/";
  const items: string[] = [];

  for (const b of visibleBlocks(t.pages[0])) {
    const label =
      b.type === "section"
        ? b.id === "records" && t.config.kind === "lmsc"
          ? "Records"
          : SECTION_NAV[b.id]
        : undefined;
    if (label) items.push(`<li><a href="${base}#${b.id}">${label}</a></li>`);
  }
  const navPages = t.pages
    .filter((p) => p.slug !== HOME_SLUG && p.nav)
    .sort((a, b) => a.nav!.order - b.nav!.order || a.title.localeCompare(b.title));
  for (const p of navPages) {
    const current = p.slug === page.slug ? ' aria-current="page"' : "";
    items.push(`<li><a href="/${p.slug}/"${current}>${esc(p.nav!.label)}</a></li>`);
  }
  items.push(`<li><a href="${base}#contact">Contact</a></li>`);
  return items.join("\n          ");
}

function pageBody(t: Tenant, page: Page, partials: Record<SectionId, string>): string {
  const parts: string[] = [];
  if (page.slug !== HOME_SLUG) {
    parts.push(`    <header class="page-header">
      <div class="container">
        <h1>${esc(page.title)}</h1>
      </div>
    </header>`);
  }
  let prev: Block | undefined;
  for (const b of visibleBlocks(page)) {
    const html =
      b.type === "section"
        ? dropDeadSectionLinks(applyTemplate(partials[b.id], t, `sections/${b.id}.html`), t)
        : `    ${renderContentBlock(b, prev)}`;
    if (html.trim()) {
      parts.push(html);
      prev = b;
    }
  }
  return parts.join("\n\n").replace(/^ {4}/, "");
}

/** Fill the page-specific markers of a rendered shell. */
export function composePage(
  shell: string,
  t: Tenant,
  page: Page,
  partials: Record<SectionId, string>
): string {
  const c = t.config;
  const isHome = page.slug === HOME_SLUG;
  let out = shell;

  // Chrome links (footer, logo) point at home-page anchors.
  if (!isHome) out = out.replace(/href="#/g, 'href="/#');

  const pageScalars: Record<string, string> = {
    title: isHome
      ? esc(page.title || `${c.name} — ${c.teamCode}`)
      : `${esc(page.title)} — ${esc(c.shortName)}`,
    description: esc(page.description || c.description),
    homeHref: isHome ? "#" : "/",
  };
  out = out.replace(/\{\{\s*page\.(\w+)\s*\}\}/g, (_, key: string) => {
    const value = pageScalars[key];
    if (value === undefined) throw new Error(`[tenant] unknown page scalar {{ page.${key} }}`);
    return value;
  });

  // Body last, so admin-authored text is never scanned for markers/scalars.
  out = out.replace("<!-- tenant:page-nav -->", () => navLinks(t, page));
  out = dropDeadSectionLinks(out, t);
  return out.replace("<!-- tenant:page-body -->", () => pageBody(t, page, partials));
}

/**
 * Remove shell/hero links to home sections the layout hides (e.g. the hero's
 * "Practice Schedule" button when there's no schedule section). Applied to the
 * shell and built-in partials only, never to admin-authored content blocks.
 */
function dropDeadSectionLinks(html: string, t: Tenant): string {
  const shown = new Set(
    visibleBlocks(t.pages[0]).flatMap((b) => (b.type === "section" ? [b.id as string] : []))
  );
  const dead = SECTION_IDS.filter((id) => !shown.has(id)).join("|");
  if (!dead) return html;
  return html
    .replace(new RegExp(`\\s*<li><a href="/?#(?:${dead})">[^<]*</a></li>`, "g"), "")
    .replace(new RegExp(`\\s*<a href="/?#(?:${dead})" class="btn[^"]*">[^<]*</a>`, "g"), "");
}

/** Map a dev-server URL like /join/ to its page (home for anything unknown). */
export function pageForUrl(t: Tenant, url: string): Page {
  const slug = url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "").replace(/\/index\.html$/, "");
  return t.pages.find((p) => p.slug === slug && slug !== HOME_SLUG) ?? t.pages[0];
}
