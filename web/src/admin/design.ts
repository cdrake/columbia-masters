// Design gallery: a Word-style picker of the club's site template (theme) and
// accent color. Hovering a card previews it on the canvas; Apply returns the
// choice. Themes are CSS-only, so thumbnails are the real section markup
// rendered small under each theme.

import type { SectionId } from "../../shared/pages";
import { accentFor, accentVars, HEX_COLOR_RE, THEME_IDS, THEMES, type SiteSettings, type ThemeId } from "../../shared/site";
import { h } from "./dom";

// Every theme's stylesheet (all scoped by [data-theme]), so any of them can preview here.
import.meta.glob("../themes/*.css", { eager: true });

interface GalleryOptions {
  current: SiteSettings;
  previews: Partial<Record<SectionId, string>>;
  tenantName: string;
  /** Show a design on the canvas (null = back to the draft). */
  preview: (s: SiteSettings | null) => void;
}

function sampleHero(name: string): string {
  return `<section class="hero"><div class="hero-content"><h1>${name} Masters</h1>
    <p class="hero-tagline">Adult swimming for every ability.</p>
    <div class="hero-actions"><a class="btn btn-primary">Try a practice</a></div></div></section>`;
}

function thumbnail(theme: ThemeId, opts: GalleryOptions): HTMLElement {
  const s: SiteSettings = { theme };
  const inner = h("div", {
    class: "adm-thumb-inner",
    "data-theme": theme,
    style: accentVars(s),
    inert: true,
  });
  const body = h("div", { class: "adm-preview" });
  body.innerHTML = (opts.previews.hero ?? sampleHero(opts.tenantName)) + (opts.previews.schedule ?? "");
  inner.append(body);
  return h("div", { class: "adm-thumb", "aria-hidden": "true" }, inner);
}

/** Opens the gallery; resolves with the chosen design, or null if cancelled. */
export function designGallery(opts: GalleryOptions): Promise<SiteSettings | null> {
  return new Promise((resolve) => {
    let choice: SiteSettings = { ...opts.current };
    let result: SiteSettings | null = null;

    const cards = new Map<ThemeId, HTMLButtonElement>();
    const fullPreview = h("a", { class: "adm-design-preview", target: "_blank", rel: "noopener" }, "Preview full site ↗");
    const presets = h("div", { class: "adm-swatches", role: "radiogroup", "aria-label": "Accent color" });
    // Built once: re-parenting an open <input type=color> would close the native picker mid-drag.
    const custom = h("input", { type: "color", "aria-label": "Custom accent color" });
    const swatches = h(
      "div",
      { class: "adm-swatches" },
      presets,
      h("label", { class: "adm-swatch-custom", title: "Pick any color" }, custom, "Custom")
    );

    function renderChoice() {
      for (const [id, card] of cards) {
        card.classList.toggle("is-selected", id === choice.theme);
        card.setAttribute("aria-pressed", String(id === choice.theme));
      }
      const accent = accentFor(choice);
      presets.replaceChildren(
        ...THEMES[choice.theme].accents.map((c, i) =>
          h("button", {
            type: "button",
            class: `adm-swatch${c === accent ? " is-selected" : ""}`,
            role: "radio",
            "aria-checked": String(c === accent),
            "aria-label": i === 0 ? `${c} (theme default)` : c,
            title: i === 0 ? "Theme default" : c,
            style: `background: ${c}`,
            onclick: () => setAccent(c),
          })
        )
      );
      if (custom.value !== accent) custom.value = accent;
      const q = new URLSearchParams({ theme: choice.theme });
      if (choice.accent) q.set("accent", choice.accent);
      fullPreview.href = `/?${q}`;
      opts.preview(choice);
    }

    function setAccent(c: string) {
      const v = c.toLowerCase();
      if (!HEX_COLOR_RE.test(v)) return;
      choice = { ...choice, accent: v };
      renderChoice();
    }

    custom.addEventListener("input", () => setAccent(custom.value));

    const grid = h("div", { class: "adm-themes", onmouseleave: () => opts.preview(choice) });
    for (const id of THEME_IDS) {
      const t = THEMES[id];
      const isCurrent = id === opts.current.theme;
      const card = h(
        "button",
        {
          type: "button",
          class: "adm-theme",
          onclick: () => {
            // A new theme starts on its own default accent.
            if (id !== choice.theme) choice = { theme: id };
            renderChoice();
          },
          onmouseenter: () => opts.preview(id === choice.theme ? choice : { theme: id }),
          onfocus: () => opts.preview(id === choice.theme ? choice : { theme: id }),
        },
        thumbnail(id, opts),
        h(
          "span",
          { class: "adm-theme-text" },
          h("strong", {}, t.label, isCurrent ? h("em", {}, " · current") : null),
          h("span", {}, t.description)
        )
      );
      cards.set(id, card);
      grid.append(card);
    }

    const d = h(
      "dialog",
      { class: "adm-dialog adm-design", "aria-label": "Site design" },
      h("h2", {}, "Site design"),
      h("p", { class: "adm-help" }, "Hover a design to preview it on the page. Your content stays the same — only the look changes."),
      grid,
      h("div", { class: "adm-accent-row" }, h("strong", {}, "Accent color"), swatches),
      h(
        "div",
        { class: "adm-dialog-actions" },
        fullPreview,
        h("button", { type: "button", class: "adm-secondary", onclick: () => d.close() }, "Cancel"),
        h("button", { type: "button", class: "adm-primary", onclick: () => ((result = choice), d.close()) }, "Apply design")
      )
    );
    d.addEventListener("close", () => {
      d.remove();
      resolve(result);
    });
    document.body.append(d);
    d.showModal();
    renderChoice();
    cards.get(choice.theme)?.focus();
  });
}
