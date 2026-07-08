import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { Marked } from "marked";

const marked = new Marked();

export interface TenantSocial {
  label: string;
  url: string;
  sameAs?: boolean;
}

export interface TenantConfig {
  slug: string;
  teamCode: string;
  lmscName: string;
  name: string;
  shortName: string;
  domain: string;
  description: string;
  hero: { sub: string; tagline: string };
  pool: string;
  address: { street: string; city: string; region: string; postalCode: string };
  scheduleNote: string;
  colors: Record<string, string>;
  socials: TenantSocial[];
  sheet: { publishedId: string; gids: Record<string, number> };
  records: { startYear: number };
  images?: { accountHash: string };
}

export interface Coach {
  name: string;
  photo: string;
  bioHtml: string;
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

export interface FallbackScheduleEntry {
  day: string;
  time: string;
  type: string;
  location?: string;
}

// Shape matches the rendered fallback markup (not Sheet rows) so the static
// no-JS/SEO content reproduces exactly with no date math at build time.
export interface FallbackEvent {
  month: string;
  day: string;
  title: string;
  detail: string;
}

export interface FallbackBoardMember {
  role: string;
  name: string;
}

export interface Tenant {
  config: TenantConfig;
  aboutHtml: string;
  coaches: Coach[];
  classes: ClassProgram[];
  fallback: {
    schedule: FallbackScheduleEntry[];
    events: FallbackEvent[];
    board: FallbackBoardMember[];
  };
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

  for (const key of [
    "slug", "teamCode", "lmscName", "name", "shortName",
    "domain", "description", "pool", "scheduleNote",
  ] as const) {
    req(typeof config[key] === "string" && config[key], `tenant.json missing "${key}"`);
  }
  req(config.slug === slug, `tenant.json slug "${config.slug}" != directory "${slug}"`);
  req(config.hero?.sub && config.hero?.tagline, `tenant.json missing hero.sub/hero.tagline`);
  req(config.address?.street && config.address?.city, `tenant.json missing address`);
  req(config.sheet?.publishedId && config.sheet?.gids, `tenant.json missing sheet config`);
  for (const tab of ["events", "schedule", "board", "content"]) {
    req(typeof config.sheet.gids[tab] === "number", `tenant.json missing sheet.gids.${tab}`);
  }
  req(Array.isArray(config.socials), `tenant.json missing socials[]`);

  const contentDir = path.join(dir, "content");
  const aboutFile = path.join(contentDir, "about.md");
  req(fs.existsSync(aboutFile), `missing ${aboutFile}`);
  const aboutHtml = mdBlock(fs.readFileSync(aboutFile, "utf8"));

  const coaches = loadMarkdownDir(path.join(contentDir, "coaches")).map(({ data, content, file }) => {
    req(data.name, `coach file ${file} missing "name" in frontmatter`);
    req(data.photo, `coach file ${file} missing "photo" in frontmatter`);
    return { name: data.name as string, photo: data.photo as string, bioHtml: mdBlock(content) };
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
  const fallback = {
    schedule: readJsonIfExists<FallbackScheduleEntry[]>(path.join(fallbackDir, "schedule.json")) ?? [],
    events: readJsonIfExists<FallbackEvent[]>(path.join(fallbackDir, "events.json")) ?? [],
    board: readJsonIfExists<FallbackBoardMember[]>(path.join(fallbackDir, "board.json")) ?? [],
  };

  const publicDir = path.join(dir, "public");
  req(fs.existsSync(publicDir), `missing ${publicDir}`);

  return { config, aboutHtml, coaches, classes, fallback, dir, publicDir };
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
