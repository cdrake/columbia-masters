// Site-wide design settings (tenants/<slug>/content/site.json): which design
// template the club uses and its accent color. Shared by the build, the editor
// and the publish API. Themes are CSS-only (web/src/themes/<id>.css, scoped by
// [data-theme="<id>"]), so switching never changes markup or element ids.

export const THEME_IDS = ["lane-line", "deep-end", "morning-swim"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  description: string;
  /** Google Fonts css2 URL, or null for system fonts. */
  fonts: string | null;
  /** Accent swatches offered in the editor; the first is the default. */
  accents: string[];
  /** Whether the theme ships a stylesheet (the default theme is plain style.css). */
  stylesheet: boolean;
}

export const THEMES: Record<ThemeId, ThemeInfo> = {
  "lane-line": {
    id: "lane-line",
    label: "Lane Line",
    description: "Classic navy and gold. Clean cards, centered headings — the original club look.",
    fonts: null,
    accents: ["#e8b931", "#4fc3d9", "#f08a5d", "#8fd16a"],
    stylesheet: false,
  },
  "deep-end": {
    id: "deep-end",
    label: "Deep End",
    description: "Dark and athletic. Huge condensed headlines and a bright accent, built for competitive clubs.",
    fonts:
      "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Big+Shoulders+Display:wght@700;900&display=swap",
    accents: ["#3fd4e0", "#c6f432", "#ff6b4a", "#ffc53d"],
    stylesheet: true,
  },
  "morning-swim": {
    id: "morning-swim",
    label: "Morning Swim",
    description: "Bright, rounded and welcoming. Friendly type that speaks to new and returning swimmers.",
    fonts:
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&display=swap",
    accents: ["#ff9a7a", "#ffd166", "#9ad8c8", "#c3b4ff"],
    stylesheet: true,
  },
};

export const DEFAULT_THEME: ThemeId = "lane-line";

export interface SiteSettings {
  theme: ThemeId;
  /** #rrggbb; omitted = the theme's default accent. */
  accent?: string;
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

export const sitePath = (tenant: string) => `tenants/${tenant}/content/site.json`;

export function siteFileContent(site: SiteSettings): string {
  const out: SiteSettings = { theme: site.theme };
  if (site.accent) out.accent = site.accent;
  return JSON.stringify(out, null, 2) + "\n";
}

export function validateSite(site: unknown): string[] {
  const s = site as SiteSettings;
  if (!s || typeof s !== "object" || Array.isArray(s)) return ["site settings must be an object"];
  const errs: string[] = [];
  if (!THEME_IDS.includes(s.theme)) errs.push(`unknown theme "${String(s.theme)}"`);
  if (s.accent !== undefined && (typeof s.accent !== "string" || !HEX_COLOR_RE.test(s.accent))) {
    errs.push("accent must be a lowercase #rrggbb color");
  }
  for (const k of Object.keys(s)) if (k !== "theme" && k !== "accent") errs.push(`unknown setting "${k}"`);
  return errs;
}

export const accentFor = (site: SiteSettings) => site.accent ?? THEMES[site.theme].accents[0];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text color for buttons/badges on the accent: whichever of near-black/white contrasts more. */
export function onAccent(hex: string): string {
  const l = luminance(hex);
  const dark = "#10161c";
  return (l + 0.05) / (luminance(dark) + 0.05) >= 1.05 / (l + 0.05) ? dark : "#ffffff";
}

/** CSS custom properties for a site's accent (inline style on <html> or the editor canvas). */
export function accentVars(site: SiteSettings): string {
  const accent = accentFor(site);
  return `--accent: ${accent}; --on-accent: ${onAccent(accent)};`;
}
