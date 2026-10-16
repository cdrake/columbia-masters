// Page/block schema shared by the build (web/build), the admin editor
// (web/src/admin) and the publish API (web/functions). Browser-safe: no node
// imports, so the editor preview renders blocks exactly like production.

import { Marked, type Tokens } from "marked";

// --- Schema ---

/** Built-in home sections. Their markup lives in web/build/sections/<id>.html. */
export const SECTION_IDS = [
  "hero", "about", "schedule", "events", "classes",
  "faq", "gallery", "coaches", "board", "records",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  hero: "Hero banner",
  about: "About",
  schedule: "Practice Schedule",
  events: "Upcoming Events",
  classes: "Classes & Programs",
  faq: "FAQ",
  gallery: "Photo Gallery",
  coaches: "Coaches",
  board: "Board & Leadership",
  records: "Team Records",
};

/** Nav label for each section's anchor link (hero has none). */
export const SECTION_NAV: Partial<Record<SectionId, string>> = {
  about: "About",
  schedule: "Schedule",
  events: "Events",
  classes: "Classes",
  faq: "FAQ",
  gallery: "Gallery",
  coaches: "Coaches",
  board: "Board",
  records: "Records",
};

export type Background = "default" | "alt";

interface BlockBase {
  id: string;
  hidden?: boolean;
}

export interface SectionBlock extends BlockBase {
  type: "section";
  id: SectionId;
}

export interface ContentBlockBase extends BlockBase {
  background?: Background;
}

export interface HeadingBlock extends ContentBlockBase {
  type: "heading";
  props: { text: string; subtitle?: string };
}

export interface RichTextBlock extends ContentBlockBase {
  type: "richText";
  props: { title?: string; markdown: string };
}

export interface ImageBlock extends ContentBlockBase {
  type: "image";
  props: { src: string; alt: string; caption?: string; width?: "narrow" | "wide" | "full" };
}

export interface ButtonItem {
  label: string;
  url: string;
  style?: "primary" | "secondary";
}

export interface ButtonsBlock extends ContentBlockBase {
  type: "buttons";
  props: { items: ButtonItem[] };
}

export interface CalloutBlock extends ContentBlockBase {
  type: "callout";
  props: { title?: string; markdown: string };
}

export interface EmbedBlock extends ContentBlockBase {
  type: "embed";
  props: { url: string; title: string; aspect?: "wide" | "tall" };
}

export interface DividerBlock extends ContentBlockBase {
  type: "divider";
  props?: Record<string, never>;
}

export type ContentBlock =
  | HeadingBlock
  | RichTextBlock
  | ImageBlock
  | ButtonsBlock
  | CalloutBlock
  | EmbedBlock
  | DividerBlock;
export type Block = SectionBlock | ContentBlock;
export type ContentBlockType = ContentBlock["type"];

export interface Page {
  slug: string;
  /** Page <title>/heading. Optional on home (falls back to the club name). */
  title: string;
  /** Meta description. Optional on home (falls back to tenant.json description). */
  description: string;
  /** Show in the main nav. Ignored on home (the logo links home). */
  nav: { label: string; order: number } | null;
  blocks: Block[];
}

export const HOME_SLUG = "home";

/** Slugs that collide with generated/static paths in tenants/<slug>/public or the app. */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "assets", "data", "gallery", "locations", "uploads",
  "workouts", "images", "coaches", "classes", "index", "404",
]);

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BLOCK_ID_RE = /^b-[a-z0-9]{4,16}$/;

export const BLOCK_TYPES: { type: ContentBlockType; label: string; description: string }[] = [
  { type: "heading", label: "Heading", description: "Large title with optional subtitle" },
  { type: "richText", label: "Text", description: "Paragraphs, lists and links (markdown)" },
  { type: "image", label: "Image", description: "Photo or flyer with caption" },
  { type: "buttons", label: "Buttons", description: "One or more link buttons" },
  { type: "callout", label: "Callout", description: "Highlighted notice box" },
  { type: "embed", label: "Embed", description: "YouTube, Google Map, Form or Calendar" },
  { type: "divider", label: "Divider", description: "Horizontal rule" },
];

/** The current hand-built home page, used when a tenant has no content/pages/ yet. */
export function defaultHomePage(): Page {
  return {
    slug: HOME_SLUG,
    title: "",
    description: "",
    nav: null,
    blocks: SECTION_IDS.map((id) => ({ id, type: "section" as const })),
  };
}

export function newBlockId(): string {
  return "b-" + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

export function newBlock(type: ContentBlockType): ContentBlock {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type, props: { text: "New heading" } };
    case "richText":
      return { id, type, props: { markdown: "Write something here." } };
    case "image":
      return { id, type, props: { src: "", alt: "", width: "wide" } };
    case "buttons":
      return { id, type, props: { items: [{ label: "Learn more", url: "/", style: "primary" }] } };
    case "callout":
      return { id, type, props: { title: "Heads up", markdown: "Important information." } };
    case "embed":
      return { id, type, props: { url: "", title: "Embedded content" } };
    case "divider":
      return { id, type };
  }
}

// --- Validation ---

const isStr = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown) => v === undefined || isStr(v);

/** Returns a list of human-readable problems; empty means valid. */
export function validatePage(page: unknown, fileSlug?: string): string[] {
  const errs: string[] = [];
  const p = page as Page;
  if (!p || typeof p !== "object") return ["page is not an object"];

  if (!isStr(p.slug) || !SLUG_RE.test(p.slug)) errs.push(`invalid slug "${p.slug}"`);
  if (fileSlug !== undefined && p.slug !== fileSlug) {
    errs.push(`slug "${p.slug}" does not match file name "${fileSlug}"`);
  }
  const isHome = p.slug === HOME_SLUG;
  if (!isHome && RESERVED_SLUGS.has(p.slug)) errs.push(`slug "${p.slug}" is reserved`);
  if (!isStr(p.title) || (!isHome && !p.title.trim())) errs.push("title is required");
  if (!isStr(p.description)) errs.push("description must be a string");
  if (p.nav !== null) {
    if (!p.nav || !isStr(p.nav.label) || !p.nav.label.trim() || typeof p.nav.order !== "number") {
      errs.push("nav must be null or { label, order }");
    }
  }
  if (!Array.isArray(p.blocks)) return [...errs, "blocks must be an array"];

  const seen = new Set<string>();
  p.blocks.forEach((b, i) => {
    const at = `block ${i + 1} (${(b as Block)?.type ?? "?"})`;
    if (!b || typeof b !== "object" || !isStr(b.id)) return errs.push(`${at}: missing id`);
    if (seen.has(b.id)) errs.push(`${at}: duplicate id "${b.id}"`);
    seen.add(b.id);
    if (b.hidden !== undefined && typeof b.hidden !== "boolean") errs.push(`${at}: hidden must be boolean`);

    if (b.type === "section") {
      if (!isHome) errs.push(`${at}: built-in sections are only allowed on the home page`);
      if (!(SECTION_IDS as readonly string[]).includes(b.id)) errs.push(`${at}: unknown section "${b.id}"`);
      return;
    }
    if (!BLOCK_ID_RE.test(b.id)) errs.push(`${at}: id "${b.id}" must look like b-xxxxxx`);
    if (b.background !== undefined && b.background !== "default" && b.background !== "alt") {
      errs.push(`${at}: invalid background`);
    }
    const props = (b as { props?: Record<string, unknown> }).props ?? {};
    switch (b.type) {
      case "heading":
        if (!isStr(props.text) || !optStr(props.subtitle)) errs.push(`${at}: needs text`);
        break;
      case "richText":
      case "callout":
        if (!isStr(props.markdown) || !optStr(props.title)) errs.push(`${at}: needs markdown`);
        break;
      case "image":
        if (!isStr(props.src) || !isStr(props.alt) || !optStr(props.caption)) {
          errs.push(`${at}: needs src and alt`);
        } else if (props.src && !safeUrl(props.src)) {
          errs.push(`${at}: unsupported image URL`);
        }
        if (props.width !== undefined && !["narrow", "wide", "full"].includes(props.width as string)) {
          errs.push(`${at}: invalid width`);
        }
        break;
      case "buttons": {
        const items = props.items as ButtonItem[] | undefined;
        if (!Array.isArray(items)) {
          errs.push(`${at}: needs items`);
          break;
        }
        items.forEach((it, j) => {
          if (!it || !isStr(it.label) || !isStr(it.url)) errs.push(`${at}: button ${j + 1} needs label and url`);
          else if (it.url && !safeUrl(it.url)) errs.push(`${at}: button ${j + 1} has an unsupported URL`);
        });
        break;
      }
      case "embed":
        if (!isStr(props.url) || !isStr(props.title)) errs.push(`${at}: needs url and title`);
        else if (props.url && !embedSrc(props.url)) errs.push(`${at}: unsupported embed URL`);
        break;
      case "divider":
        break;
      default:
        errs.push(`${at}: unknown block type`);
    }
  });
  return errs;
}

// --- Rendering ---

export function esc(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Allow site-relative, http(s), mailto and tel URLs; reject javascript: etc. */
export function safeUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  if (u.startsWith("/") || u.startsWith("#")) return u.startsWith("//") ? null : u;
  return /^(https?:|mailto:|tel:)/i.test(u) ? u : null;
}

const isExternal = (url: string) => /^https?:/i.test(url);
const linkTarget = (url: string) => (isExternal(url) ? ' target="_blank" rel="noopener"' : "");

// Admin markdown: raw HTML is escaped (not rendered) and unsafe link URLs are dropped.
const blockMarked = new Marked({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return esc(text);
    },
    link({ href, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      return url ? `<a href="${esc(url)}"${linkTarget(url)}>${text}</a>` : text;
    },
    image({ href, text }: Tokens.Image) {
      const url = safeUrl(href);
      return url ? `<img src="${esc(url)}" alt="${esc(text)}" loading="lazy" />` : "";
    },
  },
});

export function markdown(s: string): string {
  return (blockMarked.parse(s ?? "") as string).trim();
}

/** Normalize an allowlisted embed URL to its iframe src, or null if not allowed. */
export function embedSrc(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/);
      id = m?.[1] ?? null;
    }
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "google.com" && url.pathname.startsWith("/maps/embed")) return url.href;
  if (host === "docs.google.com" && /^\/forms\/d\/e\/[\w-]+\/viewform/.test(url.pathname)) {
    url.searchParams.set("embedded", "true");
    return url.href;
  }
  if (host === "calendar.google.com" && url.pathname.startsWith("/calendar/embed")) return url.href;
  return null;
}

function renderContentInner(b: ContentBlock): string {
  switch (b.type) {
    case "heading":
      return `<h2>${esc(b.props.text)}</h2>${
        b.props.subtitle ? `\n        <p class="block-subtitle">${esc(b.props.subtitle)}</p>` : ""
      }`;
    case "richText":
      return `${b.props.title ? `<h2>${esc(b.props.title)}</h2>\n        ` : ""}<div class="block-prose">${markdown(b.props.markdown)}</div>`;
    case "callout":
      return `<aside class="block-callout">${
        b.props.title ? `<div class="block-callout-title">${esc(b.props.title)}</div>` : ""
      }${markdown(b.props.markdown)}</aside>`;
    case "image": {
      const src = safeUrl(b.props.src);
      if (!src) return "";
      return `<figure class="block-figure block-figure-${b.props.width ?? "wide"}">
          <img src="${esc(src)}" alt="${esc(b.props.alt)}" loading="lazy" />${
            b.props.caption ? `\n          <figcaption>${esc(b.props.caption)}</figcaption>` : ""
          }
        </figure>`;
    }
    case "buttons": {
      const links = b.props.items
        .map((it) => {
          const url = safeUrl(it.url);
          if (!url || !it.label.trim()) return "";
          const cls = it.style === "secondary" ? "btn btn-secondary" : "btn btn-primary";
          return `<a href="${esc(url)}" class="${cls}"${linkTarget(url)}>${esc(it.label)}</a>`;
        })
        .filter(Boolean);
      return links.length ? `<div class="block-buttons">${links.join("")}</div>` : "";
    }
    case "embed": {
      const src = embedSrc(b.props.url);
      if (!src) return "";
      return `<div class="block-embed block-embed-${b.props.aspect ?? "wide"}">
          <iframe src="${esc(src)}" title="${esc(b.props.title)}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>`;
    }
    case "divider":
      return `<hr class="block-divider" />`;
  }
}

/**
 * Render one content block as a full-width section. `prev` is the preceding
 * visible block: consecutive content blocks on the same background drop the
 * top padding so a heading + text + buttons run reads as one section.
 */
export function renderContentBlock(b: ContentBlock, prev?: Block): string {
  const inner = renderContentInner(b);
  if (!inner) return "";
  const bg = b.background ?? "default";
  const tight = prev && prev.type !== "section" && (prev.background ?? "default") === bg;
  const classes = [
    "section",
    "block",
    `block-type-${b.type.toLowerCase()}`,
    bg === "alt" ? "section-alt" : "",
    tight ? "block-tight" : "",
  ].filter(Boolean);
  return `<section id="${esc(b.id)}" class="${classes.join(" ")}">
      <div class="container">
        ${inner}
      </div>
    </section>`;
}

export const visibleBlocks = (p: Page) => p.blocks.filter((b) => !b.hidden);
