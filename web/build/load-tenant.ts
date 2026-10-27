import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { Marked } from "marked";
import { defaultHomePage, HOME_SLUG, validatePage, type Page } from "../shared/pages";
import { validateSite, type SiteSettings } from "../shared/site";
import { normalizeTab, type ClubLink, type SheetData } from "../shared/content";

const marked = new Marked();

export interface TenantSocial {
  label: string;
  url: string;
  sameAs?: boolean;
}

export interface TenantDocument {
  label: string;
  url: string;
}

export interface TenantConfig {
  /** "lmsc" = a state/LMSC site (records across every club, no pool/schedule); default "club". */
  kind?: "club" | "lmsc";
  slug: string;
  teamCode: string;
  lmscName: string;
  name: string;
  shortName: string;
  domain: string;
  description: string;
  hero: { sub: string; tagline: string };
  pool: string;
  /** Optional: every practice pool (the first should match pool/address). */
  pools?: { name: string; city: string; street?: string; postalCode?: string }[];
  address: { street: string; city: string; region: string; postalCode: string };
  scheduleNote: string;
  colors: Record<string, string>;
  socials: TenantSocial[];
  // Optional club documents (e.g. bylaws PDF) linked in the footer "Resources" column.
  documents?: TenantDocument[];
  sheet: { publishedId: string; gids: Record<string, number> };
  records: { startYear: number };
  images?: { accountHash: string };
  /** Optional hero logo: a path under public/ (use a light variant — the hero is dark). */
  logo?: { src: string; alt: string; width: number; height: number };
  /** IANA zone for "upcoming" event filtering; defaults to America/New_York. */
  timeZone?: string;
  /** State (lmsc) sites: member clubs, for the content API and llms.txt. */
  clubs?: ClubLink[];
}

export interface Coach {
  name: string;
  photo: string;
  bioHtml: string;
  /** Bio markdown, for the content API / llms.txt. */
  bio: string;
}

export interface ClassProgram {
  titleHtml: string;
  flyer?: string;
  flyerAlt?: string;
  flyerAriaLabel?: string;
  callout?: { title: string; bodyHtml: string };
  links: { label: string; url: string }[];
  taglineHtml: string;
}

/** A state site's club, from public/data/clubs.json (written by `refresh` from the crawl). */
export interface ClubEntry {
  code: string;
  name?: string;
  city?: string;
  url?: string;
  note?: string;
  firstYear: number;
  lastYear: number;
  seasons: number;
  records: number;
}

export interface Tenant {
  config: TenantConfig;
  aboutHtml: string;
  /** about.md paragraphs (markdown). */
  about: string[];
  coaches: Coach[];
  classes: ClassProgram[];
  /** Snapshot of the club's Sheet (content/fallback/*.json, kept current by sync-content). */
  fallback: SheetData;
  /** Site pages from content/pages/*.json; home is always first. */
  pages: Page[];
  /** State sites: every club with records (empty for a club site). */
  clubDirectory: ClubEntry[];
  /** Design template + accent from content/site.json (written by the editor); null = default look. */
  site: SiteSettings | null;
  dir: string;
  publicDir: string;
}

/** Inline markdown → HTML, mirroring md() in src/main.ts (links open in a new tab). */
export function mdInline(s: string): string {
  if (!s) return "";
  const html = marked.parseInline(s) as string;
  return html.replace(/<a /g, '<a target="_blank" rel="noopener" ');
}

/** Block markdown → HTML paragraphs. */
export function mdBlock(s: string): string {
  return (marked.parse(s) as string).trim();
}

function req(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[tenant] ${msg}`);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function resolveTenantSlug(): string {
  return process.env.TENANT?.trim() || "colm";
}

export function loadTenant(webRoot: string, slug: string): Tenant {
  const dir = path.resolve(webRoot, "..", "tenants", slug);
  req(fs.existsSync(dir), `tenant directory not found: ${dir} (TENANT=${slug})`);

  const configFile = path.join(dir, "tenant.json");
  req(fs.existsSync(configFile), `missing ${configFile}`);
  const config = readJson<TenantConfig>(configFile);

  req(config.kind === undefined || config.kind === "club" || config.kind === "lmsc", `tenant.json kind must be "club" or "lmsc"`);
  const isLmsc = config.kind === "lmsc";
  for (const key of [
    "slug", "teamCode", "lmscName", "name", "shortName", "domain", "description",
    ...(isLmsc ? [] : (["pool", "scheduleNote"] as const)),
  ] as const) {
    req(typeof config[key] === "string" && config[key], `tenant.json missing "${key}"`);
  }
  req(config.slug === slug, `tenant.json slug "${config.slug}" != directory "${slug}"`);
  req(config.hero?.sub && config.hero?.tagline, `tenant.json missing hero.sub/hero.tagline`);
  if (isLmsc) {
    // State sites have no home pool; blank fields keep the shared renderers simple.
    config.pool ??= "";
    config.scheduleNote ??= "";
    config.address ??= { street: "", city: "", region: "", postalCode: "" };
  } else {
    req(config.address?.street && config.address?.city, `tenant.json missing address`);
  }
  req(config.sheet?.publishedId && config.sheet?.gids, `tenant.json missing sheet config`);
  for (const tab of ["events", "schedule", "board", "content"]) {
    req(typeof config.sheet.gids[tab] === "number", `tenant.json missing sheet.gids.${tab}`);
  }
  req(Array.isArray(config.socials), `tenant.json missing socials[]`);
  if (config.logo) {
    const { src, alt, width, height } = config.logo;
    req(src?.startsWith("/") && alt && width > 0 && height > 0, `tenant.json logo needs src (/path), alt, width, height`);
    req(fs.existsSync(path.join(dir, "public", src)), `tenant.json logo not found: public${src}`);
  }
  // "faq" is an optional sheet tab — tenants that haven't added it yet simply omit the gid.

  const contentDir = path.join(dir, "content");
  const aboutFile = path.join(contentDir, "about.md");
  req(fs.existsSync(aboutFile), `missing ${aboutFile}`);
  const aboutMd = fs.readFileSync(aboutFile, "utf8");
  const aboutHtml = mdBlock(aboutMd);
  const about = aboutMd.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const coaches = loadMarkdownDir(path.join(contentDir, "coaches")).map(({ data, content, file }) => {
    req(data.name, `coach file ${file} missing "name" in frontmatter`);
    req(data.photo, `coach file ${file} missing "photo" in frontmatter`);
    return { name: data.name as string, photo: data.photo as string, bioHtml: mdBlock(content), bio: content.trim() };
  });

  const classes = loadMarkdownDir(path.join(contentDir, "classes")).map(({ data, content, file }) => {
    req(data.title, `class file ${file} missing "title" in frontmatter`);
    return {
      titleHtml: data.title as string,
      flyer: data.flyer as string | undefined,
      flyerAlt: data.flyerAlt as string | undefined,
      flyerAriaLabel: data.flyerAriaLabel as string | undefined,
      callout: data.callout
        ? { title: data.callout.title as string, bodyHtml: mdInline(data.callout.body as string) }
        : undefined,
      links: (data.links ?? []) as { label: string; url: string }[],
      taglineHtml: mdInline(content.trim()),
    };
  });

  const fallbackDir = path.join(contentDir, "fallback");
  const rows = (name: string) => readJsonIfExists<Record<string, unknown>[]>(path.join(fallbackDir, `${name}.json`)) ?? [];
  const contentMap = readJsonIfExists<Record<string, string>>(path.join(fallbackDir, "content.json")) ?? {};
  const fallback: SheetData = {
    schedule: normalizeTab("schedule", rows("schedule")),
    events: normalizeTab("events", rows("events")),
    board: normalizeTab("board", rows("board")),
    faq: normalizeTab("faq", rows("faq")),
    content: normalizeTab("content", Object.entries(contentMap).map(([key, value]) => ({ key, value }))),
  };
  if (config.timeZone !== undefined) {
    let ok = true;
    try {
      new Intl.DateTimeFormat("en", { timeZone: config.timeZone });
    } catch {
      ok = false;
    }
    req(ok, `tenant.json timeZone "${config.timeZone}" is not an IANA time zone`);
  }

  const publicDir = path.join(dir, "public");
  req(fs.existsSync(publicDir), `missing ${publicDir}`);

  const pages = loadPages(path.join(contentDir, "pages"), publicDir);

  const siteFile = path.join(contentDir, "site.json");
  const site = readJsonIfExists<SiteSettings>(siteFile);
  if (site) {
    const errs = validateSite(site);
    req(!errs.length, `${siteFile}:\n  ${errs.join("\n  ")}`);
  }

  const clubDirectory = isLmsc
    ? (readJsonIfExists<{ clubs: ClubEntry[] }>(path.join(publicDir, "data", "clubs.json"))?.clubs ?? [])
    : [];

  return { config, aboutHtml, about, coaches, classes, fallback, pages, clubDirectory, site, dir, publicDir };
}

/**
 * Load and validate content/pages/*.json (written by the /admin editor). Any
 * invalid page fails the build so a bad edit never replaces the live site.
 * Tenants without a pages/ dir get the built-in home layout.
 */
function loadPages(dir: string, publicDir: string): Page[] {
  if (!fs.existsSync(dir)) return [defaultHomePage()];
  const pages = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      const page = readJson<Page>(file);
      const errs = validatePage(page, f.slice(0, -".json".length));
      req(!errs.length, `${file}:\n  ${errs.join("\n  ")}`);
      req(
        page.slug === HOME_SLUG || !fs.existsSync(path.join(publicDir, page.slug)),
        `${file}: slug "${page.slug}" collides with public/${page.slug}`
      );
      return page;
    });
  const home = pages.find((p) => p.slug === HOME_SLUG) ?? defaultHomePage();
  return [home, ...pages.filter((p) => p.slug !== HOME_SLUG)];
}

function readJsonIfExists<T>(file: string): T | null {
  return fs.existsSync(file) ? readJson<T>(file) : null;
}

function loadMarkdownDir(dir: string): { data: Record<string, any>; content: string; file: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      return { data, content, file: path.join(dir, f) };
    });
}

export function sheetUrls(config: TenantConfig): Record<string, string> {
  const base = `https://docs.google.com/spreadsheets/d/e/${config.sheet.publishedId}/pub`;
  const urls: Record<string, string> = {};
  for (const [tab, gid] of Object.entries(config.sheet.gids)) {
    urls[tab] = `${base}?gid=${gid}&single=true&output=csv`;
  }
  return urls;
}
