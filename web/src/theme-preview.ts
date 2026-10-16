// Runtime theme switching. The published design is baked into the HTML at build
// time (site.json); this lets anyone preview another one without a rebuild:
//   /?theme=deep-end&accent=%23c6f432
// Nothing is saved, and the choice is carried to other pages on the same site. On the dev server a
// floating switcher is also shown.

import { accentVars, DEFAULT_THEME, HEX_COLOR_RE, THEME_IDS, THEMES, type SiteSettings, type ThemeId } from "../shared/site";

// Lazy: a theme's CSS is only fetched when it is previewed.
const themeCss = import.meta.glob("./themes/*.css");

const loadedFonts = new Set<string>();

async function loadTheme(id: ThemeId) {
  const t = THEMES[id];
  if (t.fonts && !loadedFonts.has(t.fonts)) {
    loadedFonts.add(t.fonts);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = t.fonts;
    document.head.append(link);
  }
  if (t.stylesheet) await themeCss[`./themes/${id}.css`]?.();
}

/** Apply a design to the page (null = back to the published one baked into the HTML). */
async function applyTheme(site: SiteSettings | null, published: Published) {
  const root = document.documentElement;
  if (!site) {
    if (published.theme) root.dataset.theme = published.theme;
    else delete root.dataset.theme;
    if (published.style) root.setAttribute("style", published.style);
    else root.removeAttribute("style");
    return;
  }
  await loadTheme(site.theme);
  if (site.theme === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = site.theme;
  root.setAttribute("style", accentVars(site));
}

interface Published {
  theme: string | undefined;
  style: string | null;
}

function fromQuery(): SiteSettings | null {
  const q = new URLSearchParams(location.search);
  const theme = q.get("theme") as ThemeId | null;
  if (!theme || !THEME_IDS.includes(theme)) return null;
  const accent = q.get("accent")?.toLowerCase();
  return accent && HEX_COLOR_RE.test(accent) ? { theme, accent } : { theme };
}

function devSwitcher(published: Published, initial: SiteSettings | null) {
  let current = initial;
  const box = document.createElement("div");
  box.setAttribute(
    "style",
    "position:fixed;right:12px;bottom:12px;z-index:9999;display:flex;gap:6px;align-items:center;" +
      "padding:8px 10px;border-radius:10px;background:#16213e;color:#fff;font:13px system-ui,sans-serif;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.3)"
  );
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Preview design");
  select.append(new Option(`Published (${published.theme ?? DEFAULT_THEME})`, ""));
  for (const id of THEME_IDS) select.append(new Option(THEMES[id].label, id));
  const color = document.createElement("input");
  color.type = "color";
  color.setAttribute("aria-label", "Preview accent");
  color.setAttribute("style", "width:28px;height:24px;padding:0;border:0;background:none");

  const sync = () => {
    select.value = current?.theme ?? "";
    color.disabled = !current;
    if (current) color.value = current.accent ?? THEMES[current.theme].accents[0];
    const url = new URL(location.href);
    url.searchParams.delete("theme");
    url.searchParams.delete("accent");
    if (current) {
      url.searchParams.set("theme", current.theme);
      if (current.accent) url.searchParams.set("accent", current.accent);
    }
    history.replaceState(history.state, "", url);
  };
  select.addEventListener("change", () => {
    current = select.value ? { theme: select.value as ThemeId } : null;
    sync();
    applyTheme(current, published);
  });
  color.addEventListener("input", () => {
    if (!current) return;
    current = { ...current, accent: color.value.toLowerCase() };
    sync();
    applyTheme(current, published);
  });

  const label = document.createElement("span");
  label.textContent = "Design";
  box.append(label, select, color);
  document.body.append(box);
  sync();
  carryQuery(() => current);
}

/** Keep ?theme=/&accent= on same-site links so the preview survives navigation. */
function carryQuery(get: () => SiteSettings | null) {
  document.addEventListener("click", (e) => {
    const site = get();
    if (!site) return;
    const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.origin !== location.origin || a.target === "_blank") return;
    const url = new URL(a.href);
    if (url.pathname === location.pathname && url.hash) return;
    url.searchParams.set("theme", site.theme);
    if (site.accent) url.searchParams.set("accent", site.accent);
    a.href = url.href;
  });
}

export function initThemePreview() {
  const root = document.documentElement;
  const published: Published = { theme: root.dataset.theme, style: root.getAttribute("style") };
  const site = fromQuery();
  if (site) applyTheme(site, published);
  if (import.meta.env.DEV) devSwitcher(published, site);
  else carryQuery(() => site);
}
