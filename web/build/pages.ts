import fs from "node:fs";
import path from "node:path";
import type { ClubEntry, Tenant } from "./load-tenant";
import * as render from "./render";
import { lastName, type Swimmer, type SwimRecord } from "./swimmer-names";
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
    "club-directory": render.clubDirectory(t),
  };
}

/** Per-page `{{ key }}` scalar overrides (e.g. a club page's records source). */
export type ScalarOverrides = Record<string, string>;

/** A page plus the scalar overrides it renders with. */
export interface RenderPage {
  page: Page;
  scalars?: ScalarOverrides;
  /** Trusted build-generated body HTML, after the blocks (swimmer pages). */
  html?: string;
  /** Full <title> text (escaped), replacing "<page title> — <shortName>". */
  title?: string;
}

/** Hidden when it has nothing to show: the club directory on a club site. */
const isEmptySection = (t: Tenant, id: SectionId) => id === "clubs" && !t.clubDirectory.length;

/**
 * Fill tenant markers and `{{ key }}` scalars in trusted template HTML.
 * `<!-- tenant:page-* -->` markers and `{{ page.* }}` are left for composePage().
 */
function applyTemplate(html: string, t: Tenant, where: string, overrides: ScalarOverrides = {}): string {
  let out = html;
  for (const [name, content] of Object.entries(markers(t))) {
    out = out.replaceAll(`<!-- tenant:${name} -->`, () => content);
  }
  const leftover = out.match(/<!-- tenant:(?!page-)([\w-]+) -->/);
  if (leftover) throw new Error(`[tenant] ${where} has unknown marker ${leftover[0]}`);

  const scalars = { ...render.scalars(t), ...overrides };
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
      b.type === "section" && !isEmptySection(t, b.id)
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
  if (t.swimmers.length && t.config.kind === "lmsc") {
    const current = page.slug === "swimmers" ? ' aria-current="page"' : "";
    items.push(`<li><a href="/swimmers/"${current}>Swimmers</a></li>`);
  }
  items.push(`<li><a href="${base}#contact">Contact</a></li>`);
  return items.join("\n          ");
}

function pageBody(
  t: Tenant,
  page: Page,
  partials: Record<SectionId, string>,
  overrides: ScalarOverrides,
  html?: string
): string {
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
    if (b.type === "section" && isEmptySection(t, b.id)) continue;
    const html =
      b.type === "section"
        ? dropDeadSectionLinks(applyTemplate(partials[b.id], t, `sections/${b.id}.html`, overrides), t)
        : `    ${renderContentBlock(b, prev)}`;
    if (html.trim()) {
      parts.push(html);
      prev = b;
    }
  }
  if (html) parts.push(html);
  return parts.join("\n\n").replace(/^ {4}/, "");
}

/** Fill the page-specific markers of a rendered shell. */
export function composePage(
  shell: string,
  t: Tenant,
  page: Page,
  partials: Record<SectionId, string>,
  { scalars: overrides = {}, html, title }: Omit<RenderPage, "page"> = {}
): string {
  const c = t.config;
  const isHome = page.slug === HOME_SLUG;
  let out = shell;

  // Chrome links (footer, logo) point at home-page anchors.
  if (!isHome) out = out.replace(/href="#/g, 'href="/#');

  const pageScalars: Record<string, string> = {
    title: title ?? (isHome
      ? esc(page.title || `${c.name} — ${c.teamCode}`)
      : `${esc(page.title)} — ${esc(c.shortName)}`),
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
  return out.replace("<!-- tenant:page-body -->", () => pageBody(t, page, partials, overrides, html));
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

/** Map a dev-server URL like /join/ or /clubs/colm/ to its page (home for anything unknown). */
export function pageForUrl(t: Tenant, url: string): RenderPage {
  const slug = url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "").replace(/\/index\.html$/, "");
  const club = clubPages(t).find((c) => c.page.slug === slug);
  if (club) return club;
  if (t.swimmers.length && slug === "swimmers") return swimmerIndexPage(t);
  const swimmer = t.swimmers.find((s) => `swimmers/${s.slug}` === slug);
  if (swimmer) return swimmerPage(t, swimmer);
  return { page: t.pages.find((p) => p.slug === slug && slug !== HOME_SLUG) ?? t.pages[0] };
}

/**
 * State sites: one generated page per club (`clubs/<code>/`) with an intro and the
 * records section pointed at that club's own records file.
 */
export function clubPages(t: Tenant): RenderPage[] {
  return t.clubDirectory.map((k) => clubPage(t, k));
}

function clubPage(t: Tenant, k: ClubEntry): RenderPage {
  const c = t.config;
  const name = k.name ?? k.code;
  const title = k.name && k.name !== k.code ? `${k.name} (${k.code})` : k.code;
  const seasons = `${k.seasons} season${k.seasons === 1 ? "" : "s"}`;
  const lines = [
    `Top times by **${k.code}** swimmers in ${c.lmscName}, ${render.clubSpan(k)} (${seasons}, ${k.records.toLocaleString("en-US")} swims), from the USMS Top Times database.`,
    [k.city, k.note].filter(Boolean).join(" · "),
    [k.url ? `[Club website](${k.url})` : "", `[All ${c.lmscName} clubs](/#clubs)`].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const page: Page = {
    slug: render.clubPath(k.code).replace(/^\/|\/$/g, ""),
    title,
    description: `${name} US Masters Swimming top times in ${c.lmscName}, ${render.clubSpan(k)}.`,
    nav: null,
    blocks: [
      { id: "b-clubintro", type: "richText", props: { markdown: lines.join("\n\n") } },
      { id: "records", type: "section" },
    ],
  };
  return {
    page,
    scalars: {
      recordsTitle: `${esc(k.code)} Records`,
      teamHeader: "",
      teamFilter: "",
      recordsSrc: `data/clubs/${encodeURIComponent(k.code)}.json`,
    },
  };
}

/** /swimmers/ plus one /swimmers/<slug>/ page per swimmer (tenant.json swimmerPages). */
export function swimmerPages(t: Tenant): RenderPage[] {
  if (!t.swimmers.length) return [];
  return [swimmerIndexPage(t), ...t.swimmers.map((s) => swimmerPage(t, s))];
}

const COURSES = ["scy", "scm", "lcm"];
const STROKES = ["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "Individual Medley"];

/** Course, then stroke, then distance ("100 Y Freestyle"). */
function byEvent(a: SwimRecord, b: SwimRecord): number {
  const [da, , ...sa] = a.event.split(" ");
  const [db, , ...sb] = b.event.split(" ");
  return (
    COURSES.indexOf(a.course) - COURSES.indexOf(b.course) ||
    STROKES.indexOf(sa.join(" ")) - STROKES.indexOf(sb.join(" ")) ||
    Number(da) - Number(db) ||
    a.event.localeCompare(b.event)
  );
}

/** Fastest swim per event + course; rows without a time rank last. */
function personalBests(records: SwimRecord[]): SwimRecord[] {
  const best = new Map<string, SwimRecord>();
  for (const r of records) {
    const key = `${r.event}|${r.course}`;
    const cur = best.get(key);
    if (!cur || (r.timeInSeconds ?? Infinity) < (cur.timeInSeconds ?? Infinity)) best.set(key, r);
  }
  return [...best.values()].sort(byEvent);
}

function swimTable(rows: SwimRecord[], withYear: boolean): string {
  const head = ["Event", "Course", "Time", "Age Group", ...(withYear ? ["Year"] : []), "Meet"];
  const body = rows.map(
    (r) => `<tr>
                <td>${esc(r.event)}</td>
                <td>${esc(r.course.toUpperCase())}</td>
                <td class="time">${esc(r.time)}</td>
                <td>${esc(r.ageGroup)}</td>${withYear ? `
                <td>${esc(r.year ?? "")}</td>` : ""}
                <td>${esc(r.meet)}</td>
              </tr>`
  );
  return `<div class="table-wrap">
            <table>
              <thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
              <tbody>
              ${body.join("\n              ")}
              </tbody>
            </table>
          </div>`;
}

/** JSON for an inline <script>: keep "</script>" in data from closing it. */
const scriptJson = (data: unknown) => JSON.stringify(data, null, 2).replace(/</g, "\\u003c");

function swimmerPage(t: Tenant, s: Swimmer): RenderPage {
  const c = t.config;
  const counts = new Map<string, number>();
  for (const r of s.records) counts.set(r.team, (counts.get(r.team) ?? 0) + 1);
  const teams = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  const club = (code: string) => t.clubDirectory.find((k) => k.code === code);
  const teamName = (code: string) => club(code)?.name ?? (code === c.teamCode ? c.name : code);
  const teamLinks = teams
    .map((code) => (club(code) ? `<a href="${render.clubPath(code)}">${esc(code)}</a>` : esc(code)))
    .join(", ");

  const years = s.records.map((r) => Number(r.year)).filter(Boolean);
  const span = years.length
    ? Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`
    : "";
  const swims = `${s.records.length.toLocaleString("en-US")} swim${s.records.length === 1 ? "" : "s"}`;
  const pbs = personalBests(s.records);

  const byYear = new Map<string, SwimRecord[]>();
  for (const r of s.records) byYear.set(r.year ?? "", [...(byYear.get(r.year ?? "") ?? []), r]);
  const yearSections = [...byYear.keys()]
    .sort((a, b) => (b || "0").localeCompare(a || "0"))
    .map((y) => `<h3>${esc(y || "Year unknown")}</h3>
          ${swimTable(byYear.get(y)!.sort(byEvent), false)}`);

  // Signature events (most swims) for the meta description.
  const eventCounts = new Map<string, number>();
  for (const r of s.records) eventCounts.set(`${r.event}|${r.course}`, (eventCounts.get(`${r.event}|${r.course}`) ?? 0) + 1);
  const top = [...pbs]
    .sort((a, b) => eventCounts.get(`${b.event}|${b.course}`)! - eventCounts.get(`${a.event}|${a.course}`)!)
    .slice(0, 3)
    .map((r) => `${r.event} ${r.course.toUpperCase()} ${r.time}`);

  const url = `${c.domain}/swimmers/${s.slug}/`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: s.name,
    url,
    memberOf: teams.map((code) => ({
      "@type": "SportsOrganization",
      name: teamName(code),
      ...(club(code) ? { url: c.domain + render.clubPath(code) } : code === c.teamCode ? { url: c.domain } : {}),
    })),
  };

  const page: Page = {
    slug: `swimmers/${s.slug}`,
    title: s.name,
    description: `${s.name}: US Masters Swimming top times for ${teams.join(", ")}${span ? ` (${span})` : ""}. Best: ${top.join(", ")}.`,
    nav: null,
    blocks: [],
  };
  const html = `    <section class="section swimmer-page">
      <div class="container">
        <p class="swimmer-summary">${teams.length === 1 ? "Club" : "Clubs"}: ${teamLinks}${span ? ` · ${span}` : ""} · ${swims}</p>

        <h2>Personal bests</h2>
          ${swimTable(pbs, true)}

        <h2>All top times</h2>
          ${yearSections.join("\n          ")}

        <p class="swimmer-links"><a href="/#records">Search all records</a> · <a href="/swimmers/">All swimmers</a></p>
      </div>
    </section>
    <script type="application/ld+json">
${scriptJson(jsonLd)}
    </script>`;
  return { page, html, title: `${esc(s.name)} — ${esc(c.shortName)} top times` };
}

function swimmerIndexPage(t: Tenant): RenderPage {
  const c = t.config;
  const letter = (s: Swimmer) => (/^[a-z]/i.test(lastName(s.name)) ? lastName(s.name)[0].toUpperCase() : "#");
  const sorted = [...t.swimmers].sort(
    (a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name)
  );
  const groups = new Map<string, Swimmer[]>();
  for (const s of sorted) groups.set(letter(s), [...(groups.get(letter(s)) ?? []), s]);
  const id = (l: string) => (l === "#" ? "letter-other" : `letter-${l.toLowerCase()}`);
  const page: Page = {
    slug: "swimmers",
    title: "Swimmers",
    description: `Top times for ${t.swimmers.length.toLocaleString("en-US")} ${c.shortName} swimmers from the USMS Top Times database.`,
    nav: null,
    blocks: [],
  };
  const html = `    <section class="section swimmer-index">
      <div class="container">
        <p class="swimmer-letters">${[...groups.keys()].map((l) => `<a href="#${id(l)}">${l}</a>`).join(" ")}</p>
        ${[...groups]
          .map(([l, list]) => `<h2 id="${id(l)}">${l}</h2>
        <ul>
          ${list.map((s) => `<li><a href="/swimmers/${s.slug}/">${esc(s.name)}</a></li>`).join("\n          ")}
        </ul>`)
          .join("\n        ")}
      </div>
    </section>`;
  return { page, html };
}
