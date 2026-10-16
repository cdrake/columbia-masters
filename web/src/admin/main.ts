// /admin/ site editor: drag-and-drop blocks, page management, publish.
// State is a list of Page objects (shared/pages.ts); Publish sends them all to
// /api/admin/publish, which commits them to the repo (or writes files in dev).

import Sortable from "sortablejs";
import "../style.css";
import "./admin.css";
import {
  BLOCK_TYPES,
  esc,
  HOME_SLUG,
  newBlock,
  renderContentBlock,
  SECTION_IDS,
  SECTION_LABELS,
  SLUG_RE,
  RESERVED_SLUGS,
  validatePage,
  type Block,
  type ContentBlockType,
  type Page,
  type SectionId,
} from "../../shared/pages";
import type { AdminState } from "../../shared/publish";
import { ApiFailure, loadState, publish } from "./api";
import { checkbox, field, h, textArea, textInput } from "./dom";
import { blockForm, blockLabel } from "./forms";
import {
  clearUploads,
  exportUploads,
  importUploads,
  pendingUploads,
  previewHtml,
  pruneUploads,
} from "./uploads";

// --- State ---

let server: AdminState;
/** Version the draft is based on; sent with Publish for conflict detection. */
let baseVersion = "";
let pages: Page[] = [];
let page: Page;
let selected: Block | null = null;
let sectionPreviews: Partial<Record<SectionId, string>> = {};
let blockSortable: Sortable | null = null;
let pageSortable: Sortable | null = null;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const isHome = (p: Page) => p.slug === HOME_SLUG;
const draftKey = () => `site-editor-draft:${server.tenant}`;
const PUBLISHED_FLAG = "site-editor-published";

function navPages(): Page[] {
  return pages.filter((p) => !isHome(p) && p.nav).sort((a, b) => a.nav!.order - b.nav!.order);
}

function otherPages(): Page[] {
  return pages.filter((p) => !isHome(p) && !p.nav).sort((a, b) => a.title.localeCompare(b.title));
}

/** Pages keyed by slug, for order-insensitive comparison with the server copy. */
function canonical(ps: Page[]): string {
  return JSON.stringify([...ps].sort((a, b) => a.slug.localeCompare(b.slug)));
}

const isDirty = () => canonical(pages) !== canonical(server.pages) || pendingUploads().length > 0;

function problems(): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const name = isHome(p) ? "Home" : p.title || p.slug;
    for (const e of validatePage(p)) errs.push(`${name}: ${e}`);
    if (seen.has(p.slug)) errs.push(`${name}: another page already uses the address /${p.slug}/`);
    seen.add(p.slug);
  }
  return errs;
}

// --- Persistence (per-browser draft) ---

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    pruneUploads(JSON.stringify(pages));
    try {
      if (!isDirty()) return localStorage.removeItem(draftKey());
      const draft = { version: baseVersion, pages, uploads: exportUploads() };
      try {
        localStorage.setItem(draftKey(), JSON.stringify(draft));
      } catch {
        // Over quota (large images): keep the page edits at least.
        localStorage.setItem(draftKey(), JSON.stringify({ ...draft, uploads: {} }));
      }
    } catch {
      // Storage unavailable (private mode); the draft just won't survive a reload.
    }
  }, 300);
}

function restoreDraft(): boolean {
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return false;
    const draft = JSON.parse(raw) as { version: string; pages: Page[]; uploads?: Parameters<typeof importUploads>[0] };
    if (!Array.isArray(draft.pages) || !draft.pages.some(isHome)) return false;
    pages = draft.pages;
    baseVersion = draft.version;
    importUploads(draft.uploads);
    return true;
  } catch {
    return false;
  }
}

// --- Change notifications ---

/** Something changed that affects layout: re-render everything except the form. */
function structureChanged() {
  persist();
  renderPagesList();
  renderCanvas();
  renderStatus();
}

/** Props of the selected block changed: refresh just its preview. */
function propsChanged() {
  persist();
  if (selected) updateCard(selected);
  renderStatus();
}

// --- Layout ---

const ui = {
  status: h("div", { class: "adm-status", role: "status" }),
  view: h("a", { class: "adm-top-link", target: "_blank", rel: "noopener" }, "View live page ↗"),
  discard: h("button", { type: "button", class: "adm-secondary", onclick: () => discard() }, "Discard changes"),
  publish: h("button", { type: "button", class: "adm-primary", onclick: () => publishFlow() }, "Publish"),
  pages: h("ul", { class: "adm-pages" }),
  otherPages: h("ul", { class: "adm-pages" }),
  palette: h("ul", { class: "adm-palette" }),
  canvas: h("div", { class: "adm-canvas-inner" }),
  props: h("div", { class: "adm-props-inner" }),
  toast: h("div", { class: "adm-toast", role: "alert", hidden: true }),
  user: h("span", { class: "adm-user" }),
};

function mountSkeleton() {
  const app = document.getElementById("app")!;
  app.replaceChildren(
    h(
      "header",
      { class: "adm-top" },
      h("div", { class: "adm-brand" }, "Site Editor ", h("span", {}, server.tenant.toUpperCase())),
      ui.status,
      h("div", { class: "adm-actions" }, ui.user, ui.view, ui.discard, ui.publish)
    ),
    h(
      "div",
      { class: "adm-main" },
      h(
        "aside",
        { class: "adm-left" },
        h("h2", {}, "Pages"),
        ui.pages,
        ui.otherPages,
        h("button", { type: "button", class: "adm-secondary adm-block-btn", onclick: () => newPageFlow() }, "+ New page"),
        h("h2", {}, "Add a block"),
        h("p", { class: "adm-help" }, "Drag onto the page, or click to add below the selected block."),
        ui.palette
      ),
      h("main", { class: "adm-canvas", "aria-label": "Page layout" }, ui.canvas),
      h("aside", { class: "adm-right", "aria-label": "Settings" }, ui.props)
    ),
    ui.toast
  );

  ui.palette.append(
    ...BLOCK_TYPES.map((t) =>
      h(
        "li",
        { class: "adm-palette-item", "data-type": t.type, tabindex: 0, title: t.description,
          onclick: () => addBlock(t.type),
          onkeydown: (e: KeyboardEvent) => e.key === "Enter" && addBlock(t.type) },
        h("strong", {}, t.label),
        h("span", {}, t.description)
      )
    )
  );
  Sortable.create(ui.palette, {
    group: { name: "blocks", pull: "clone", put: false },
    sort: false,
    animation: 150,
    forceFallback: true,
    fallbackTolerance: 5,
  });

  if (server.user) {
    ui.user.append(
      server.user,
      server.backend === "github" ? h("a", { href: "/cdn-cgi/access/logout", class: "adm-top-link" }, "Sign out") : ""
    );
  }
}

// --- Pages list ---

function pageItem(p: Page): HTMLLIElement {
  const label = isHome(p) ? "Home" : p.title || "(untitled)";
  return h(
    "li",
    { class: `adm-page${p === page ? " is-current" : ""}${isHome(p) ? " adm-page-fixed" : ""}`, "data-slug": p.slug },
    h(
      "button",
      { type: "button", onclick: () => selectPage(p) },
      !isHome(p) && p.nav ? h("span", { class: "adm-handle", "aria-hidden": "true" }, "⠿") : null,
      h("span", { class: "adm-page-title" }, label),
      h("span", { class: "adm-page-path" }, isHome(p) ? "/" : `/${p.slug}/`)
    )
  );
}

function renderPagesList() {
  const home = pages.find(isHome)!;
  ui.pages.replaceChildren(pageItem(home), ...navPages().map(pageItem));
  const others = otherPages();
  ui.otherPages.replaceChildren(
    ...(others.length ? [h("li", { class: "adm-subhead" }, "Not in the menu"), ...others.map(pageItem)] : [])
  );

  pageSortable?.destroy();
  pageSortable = Sortable.create(ui.pages, {
    handle: ".adm-handle",
    filter: ".adm-page-fixed",
    animation: 150,
    forceFallback: true,
    fallbackTolerance: 5,
    onMove: (e) => !e.related.classList.contains("adm-page-fixed"),
    onEnd: () => {
      const order = [...ui.pages.querySelectorAll<HTMLElement>("[data-slug]")].map((li) => li.dataset.slug);
      navPages().forEach((p) => (p.nav!.order = order.indexOf(p.slug)));
      structureChanged();
    },
  });
}

function selectPage(p: Page) {
  page = p;
  selected = null;
  renderPagesList();
  renderCanvas();
  renderProps();
  renderStatus();
}

// --- Canvas ---

function previewFor(b: Block, prev: Block | undefined): string {
  if (b.type === "section") {
    return (
      sectionPreviews[b.id] ??
      `<div class="adm-placeholder"><strong>${esc(SECTION_LABELS[b.id])}</strong><br>Built-in section — content comes from the Google Sheet and site files.</div>`
    );
  }
  const html = renderContentBlock(b, prev);
  return html
    ? previewHtml(html)
    : `<div class="adm-placeholder"><strong>${esc(blockLabel(b))}</strong><br>Fill in the details on the right.</div>`;
}

function prevVisible(b: Block): Block | undefined {
  const i = page.blocks.indexOf(b);
  for (let j = i - 1; j >= 0; j--) if (!page.blocks[j].hidden) return page.blocks[j];
  return undefined;
}

function toolButton(label: string, icon: string, onclick: () => void, disabled = false) {
  return h(
    "button",
    {
      type: "button",
      class: "adm-tool",
      title: label,
      "aria-label": label,
      disabled,
      onclick: (e: Event) => (e.stopPropagation(), onclick()),
    },
    icon
  );
}

function blockCard(b: Block): HTMLElement {
  const i = page.blocks.indexOf(b);
  const isSection = b.type === "section";
  const card = h(
    "div",
    {
      class: `adm-block${b === selected ? " is-selected" : ""}${b.hidden ? " is-hidden" : ""}${isSection ? " is-section" : ""}`,
      "data-id": b.id,
      onclick: () => selectBlock(b),
    },
    h(
      "div",
      { class: "adm-block-bar" },
      h("span", { class: "adm-handle", title: "Drag to move", "aria-hidden": "true" }, "⠿"),
      h(
        "button",
        { type: "button", class: "adm-block-label", onclick: (e: Event) => (e.stopPropagation(), selectBlock(b)) },
        blockLabel(b),
        b.hidden ? h("em", {}, " — hidden") : null
      ),
      h(
        "span",
        { class: "adm-tools" },
        toolButton("Move up", "↑", () => moveBlock(b, -1), i === 0),
        toolButton("Move down", "↓", () => moveBlock(b, 1), i === page.blocks.length - 1),
        toolButton(b.hidden ? "Show" : "Hide", b.hidden ? "◌" : "◉", () => {
          b.hidden = b.hidden ? undefined : true;
          structureChanged();
          if (b === selected) renderProps();
        }),
        isSection ? null : toolButton("Duplicate", "⧉", () => duplicateBlock(b)),
        isSection ? null : toolButton("Delete", "✕", () => deleteBlock(b))
      )
    ),
    h("div", { class: "adm-preview", inert: true })
  );
  card.querySelector(".adm-preview")!.innerHTML = previewFor(b, prevVisible(b));
  return card;
}

function updateCard(b: Block) {
  const card = ui.canvas.querySelector<HTMLElement>(`.adm-block[data-id="${b.id}"]`);
  card?.replaceWith(blockCard(b));
}

function renderCanvas() {
  ui.view.href = isHome(page) ? "/" : `/${page.slug}/`;
  const list = h("div", { class: "adm-blocks" }, ...page.blocks.map(blockCard));
  const frame = h("div", { class: "adm-frame" });
  if (!isHome(page)) {
    frame.insertAdjacentHTML(
      "beforeend",
      `<header class="page-header"><div class="container"><h1>${esc(page.title || "Untitled page")}</h1></div></header>`
    );
  }
  frame.append(list);
  if (!page.blocks.length) {
    list.append(h("div", { class: "adm-drop-hint" }, "Drag a block here from the left to start building this page."));
  }
  ui.canvas.replaceChildren(frame);

  blockSortable?.destroy();
  blockSortable = Sortable.create(list, {
    group: { name: "blocks", pull: false, put: true },
    handle: ".adm-block-bar",
    filter: ".adm-tool",
    preventOnFilter: false,
    draggable: ".adm-block",
    animation: 150,
    forceFallback: true,
    fallbackTolerance: 5,
    onAdd: (e) => {
      const type = (e.item as HTMLElement).dataset.type as ContentBlockType;
      e.item.remove();
      insertBlock(newBlock(type), countBlocksBefore(list, e.newIndex ?? page.blocks.length));
    },
    onEnd: (e) => {
      if (e.oldIndex === undefined || e.newIndex === undefined || e.oldIndex === e.newIndex) return;
      const [b] = page.blocks.splice(e.oldIndex, 1);
      page.blocks.splice(e.newIndex, 0, b);
      structureChanged();
    },
  });
}

/** Sortable's index counts the drop hint too; map it to a blocks index. */
function countBlocksBefore(list: HTMLElement, domIndex: number): number {
  return [...list.children].slice(0, domIndex).filter((c) => c.classList.contains("adm-block")).length;
}

// --- Block operations ---

function selectBlock(b: Block | null) {
  selected = b;
  for (const el of ui.canvas.querySelectorAll(".adm-block")) {
    el.classList.toggle("is-selected", !!b && (el as HTMLElement).dataset.id === b.id);
  }
  renderProps();
}

function insertBlock(b: Block, index: number) {
  page.blocks.splice(index, 0, b);
  selected = b;
  structureChanged();
  renderProps();
  ui.canvas.querySelector(`.adm-block[data-id="${b.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function addBlock(type: ContentBlockType) {
  const i = selected ? page.blocks.indexOf(selected) : -1;
  insertBlock(newBlock(type), i >= 0 ? i + 1 : page.blocks.length);
}

function moveBlock(b: Block, delta: number) {
  const i = page.blocks.indexOf(b);
  const j = i + delta;
  if (j < 0 || j >= page.blocks.length) return;
  page.blocks.splice(i, 1);
  page.blocks.splice(j, 0, b);
  structureChanged();
  ui.canvas.querySelector<HTMLElement>(`.adm-block[data-id="${b.id}"] .adm-tool[aria-label="Move ${delta < 0 ? "up" : "down"}"]`)?.focus();
}

function duplicateBlock(b: Block) {
  if (b.type === "section") return;
  const copy = { ...clone(b), id: newBlock(b.type).id };
  insertBlock(copy, page.blocks.indexOf(b) + 1);
}

async function deleteBlock(b: Block) {
  if (!(await confirmDialog(`Delete this ${blockLabel(b).toLowerCase()} block?`, "Delete", true))) return;
  page.blocks.splice(page.blocks.indexOf(b), 1);
  if (selected === b) selected = null;
  structureChanged();
  renderProps();
}

// --- Settings panel ---

function renderProps() {
  if (selected) {
    const b = selected;
    ui.props.replaceChildren(
      h("button", { type: "button", class: "adm-link-btn", onclick: () => selectBlock(null) }, "← Page settings"),
      blockForm(b, {
        changed: propsChanged,
        rebuild: () => {
          propsChanged();
          renderProps();
        },
      })
    );
    return;
  }
  ui.props.replaceChildren(pageSettings(page));
}

function pageSettings(p: Page): HTMLElement {
  const wrap = h("div", { class: "adm-form" }, h("h2", {}, isHome(p) ? "Home page settings" : "Page settings"));
  const titleChanged = () => {
    renderPagesList();
    const h1 = ui.canvas.querySelector(".page-header h1");
    if (h1) h1.textContent = p.title || "Untitled page";
    persist();
    renderStatus();
  };

  if (isHome(p)) {
    wrap.append(
      field("Browser tab title (optional)", textInput(p.title, (v) => ((p.title = v), titleChanged())),
        "Leave blank to use the club name."),
      field("Search engine description (optional)", textArea(p.description, (v) => ((p.description = v), persist()), 3),
        "Leave blank to use the club description from the site settings."),
      h("p", { class: "adm-help" }, "Tip: drag sections to reorder the home page, or click one to hide it.")
    );
    return wrap;
  }

  const wasPublished = server.pages.some((sp) => sp.slug === p.slug);
  const slugHelp = h("p", { class: "adm-help" });
  const updateSlugHelp = () => {
    const taken = pages.some((o) => o !== p && o.slug === p.slug);
    slugHelp.textContent = !SLUG_RE.test(p.slug)
      ? "Use lowercase letters, numbers and dashes."
      : RESERVED_SLUGS.has(p.slug)
        ? "That address is reserved — choose another."
        : taken
          ? "Another page already uses this address."
          : `${location.origin}/${p.slug}/${wasPublished ? " — changing it breaks old links." : ""}`;
    slugHelp.classList.toggle("adm-error", !SLUG_RE.test(p.slug) || RESERVED_SLUGS.has(p.slug) || taken);
  };
  updateSlugHelp();

  const navLabel = textInput(p.nav?.label ?? p.title, (v) => {
    if (p.nav) p.nav.label = v;
    renderPagesList();
    persist();
    renderStatus();
  });
  navLabel.disabled = !p.nav;

  wrap.append(
    field("Page title", textInput(p.title, (v) => ((p.title = v), titleChanged()))),
    field("Web address", textInput(p.slug, (v) => {
      p.slug = v.trim().toLowerCase();
      updateSlugHelp();
      renderPagesList();
      ui.view.href = `/${p.slug}/`;
      persist();
      renderStatus();
    }, { spellcheck: false })),
    slugHelp,
    field("Search engine description", textArea(p.description, (v) => ((p.description = v), persist()), 3),
      "One or two sentences shown in Google results."),
    checkbox("Show in the site menu", !!p.nav, (v) => {
      p.nav = v ? { label: navLabel.value || p.title, order: navPages().length + 1 } : null;
      navLabel.disabled = !v;
      structureChanged();
    }),
    field("Menu label", navLabel),
    h("hr", { class: "adm-sep" }),
    h("button", { type: "button", class: "adm-danger", onclick: () => deletePage(p) }, "Delete this page")
  );
  return wrap;
}

async function deletePage(p: Page) {
  const ok = await confirmDialog(
    `Delete the page “${p.title || p.slug}”? It will disappear from the site when you publish.`,
    "Delete page",
    true
  );
  if (!ok) return;
  pages.splice(pages.indexOf(p), 1);
  selectPage(pages.find(isHome)!);
  persist();
}

function slugFromTitle(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
  let slug = RESERVED_SLUGS.has(base) || base === HOME_SLUG ? `${base}-page` : base;
  for (let n = 2; pages.some((p) => p.slug === slug); n++) slug = `${base}-${n}`;
  return slug;
}

async function newPageFlow() {
  const title = await promptDialog("New page", "Page title", "e.g. Join the Club");
  if (!title) return;
  const p: Page = {
    slug: slugFromTitle(title),
    title,
    description: "",
    nav: { label: title, order: navPages().length + 1 },
    blocks: [newBlock("richText")],
  };
  pages.push(p);
  selectPage(p);
  persist();
}

// --- Status / publish ---

function renderStatus() {
  const errs = problems();
  const dirty = isDirty();
  ui.status.replaceChildren();
  ui.status.className = "adm-status";
  if (errs.length) {
    ui.status.classList.add("is-error");
    ui.status.append(
      h("button", { type: "button", class: "adm-link-btn", onclick: () => showProblems(errs) },
        `${errs.length} problem${errs.length > 1 ? "s" : ""} to fix before publishing`)
    );
  } else if (dirty) {
    ui.status.classList.add("is-dirty");
    ui.status.append("Unpublished changes (saved in this browser)");
  } else {
    ui.status.append("Everything is published");
  }
  ui.publish.disabled = !dirty || errs.length > 0;
  ui.discard.disabled = !dirty;
}

function showProblems(errs: string[]) {
  const d = h(
    "dialog",
    { class: "adm-dialog" },
    h("h2", {}, "Fix these before publishing"),
    h("ul", { class: "adm-problems" }, ...errs.map((e) => h("li", {}, e))),
    h("div", { class: "adm-dialog-actions" }, h("button", { type: "button", class: "adm-primary", onclick: () => d.close() }, "OK"))
  );
  openDialog(d);
}

async function publishFlow() {
  const message = await promptDialog("Publish changes", "What did you change? (optional)", "e.g. Added a Join page", true);
  if (message === null) return;
  await doPublish(message, false);
}

async function doPublish(message: string, overwrite: boolean) {
  ui.publish.disabled = true;
  ui.publish.textContent = "Publishing…";
  try {
    const result = await publish({ version: baseVersion, overwrite, message, pages, uploads: pendingUploads() });
    try {
      sessionStorage.setItem(PUBLISHED_FLAG, result.commitUrl ?? "");
    } catch {
      // ignore
    }
    server = { ...server, version: result.version, pages: clone(pages) };
    baseVersion = result.version;
    clearUploads();
    try {
      localStorage.removeItem(draftKey());
    } catch {
      // ignore
    }
    showPublished(result.commitUrl);
  } catch (e) {
    const err = e as ApiFailure;
    if (err.status === 409) {
      const choice = await choiceDialog(
        "Someone else published changes",
        "The site was updated by another editor since you started. You can load their version (your changes will be lost) or publish yours anyway (their changes to pages will be replaced).",
        [["latest", "Load their version"], ["overwrite", "Publish mine anyway"]]
      );
      if (choice === "overwrite") return doPublish(message, true);
      if (choice === "latest") return reloadFromServer();
    } else {
      toast(err.message + (err.details?.length ? `\n• ${err.details.join("\n• ")}` : ""), "error");
    }
  } finally {
    ui.publish.textContent = "Publish";
    renderStatus();
  }
}

function showPublished(commitUrl?: string) {
  const live = server.backend === "github"
    ? "Published! The live site will update in about 2 minutes."
    : "Saved to the tenant files (dev mode).";
  toast(live, "ok", commitUrl ? { href: commitUrl, label: "View change" } : undefined);
}

async function discard() {
  if (!(await confirmDialog("Discard all unpublished changes?", "Discard", true))) return;
  await reloadFromServer();
}

async function reloadFromServer() {
  server = await loadState();
  server.pages.sort((a, b) => (isHome(a) ? -1 : isHome(b) ? 1 : 0));
  pages = clone(server.pages);
  baseVersion = server.version;
  clearUploads();
  try {
    localStorage.removeItem(draftKey());
  } catch {
    // ignore
  }
  selectPage(pages.find((p) => p.slug === page?.slug) ?? pages.find(isHome)!);
}

// --- Dialogs & toast (no native alert/confirm: they block the page) ---

function openDialog(d: HTMLDialogElement) {
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
}

function choiceDialog(title: string, message: string, choices: [string, string][], danger = false): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const d = h(
      "dialog",
      { class: "adm-dialog" },
      h("h2", {}, title),
      message ? h("p", {}, message) : null,
      h(
        "div",
        { class: "adm-dialog-actions" },
        h("button", { type: "button", class: "adm-secondary", onclick: () => d.close() }, "Cancel"),
        ...choices.map(([value, label], i) =>
          h(
            "button",
            {
              type: "button",
              class: i === choices.length - 1 ? (danger ? "adm-danger" : "adm-primary") : "adm-secondary",
              onclick: () => ((result = value), d.close()),
            },
            label
          )
        )
      )
    );
    d.addEventListener("close", () => resolve(result));
    openDialog(d);
  });
}

async function confirmDialog(message: string, okLabel: string, danger = false): Promise<boolean> {
  return (await choiceDialog(message, "", [["ok", okLabel]], danger)) === "ok";
}

function promptDialog(title: string, label: string, placeholder: string, optional = false): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h("input", { type: "text", placeholder, required: !optional });
    const form = h(
      "form",
      {
        method: "dialog",
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!optional && !input.value.trim()) return input.focus();
          result = input.value.trim();
          d.close();
        },
      },
      h("h2", {}, title),
      field(label, input),
      h(
        "div",
        { class: "adm-dialog-actions" },
        h("button", { type: "button", class: "adm-secondary", onclick: () => d.close() }, "Cancel"),
        h("button", { type: "submit", class: "adm-primary" }, title.startsWith("Publish") ? "Publish" : "Create")
      )
    );
    const d = h("dialog", { class: "adm-dialog" }, form);
    d.addEventListener("close", () => resolve(result));
    openDialog(d);
    input.focus();
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string, kind: "ok" | "error" | "info", link?: { href: string; label: string }) {
  clearTimeout(toastTimer);
  ui.toast.className = `adm-toast is-${kind}`;
  ui.toast.replaceChildren(
    h("span", {}, message),
    link ? h("a", { href: link.href, target: "_blank", rel: "noopener" }, link.label) : "",
    h("button", { type: "button", class: "adm-tool", "aria-label": "Dismiss", onclick: () => (ui.toast.hidden = true) }, "✕")
  );
  ui.toast.hidden = false;
  if (kind !== "error") toastTimer = setTimeout(() => (ui.toast.hidden = true), 8000);
}

// --- Section previews (from the live home page) ---

async function loadSectionPreviews() {
  try {
    const res = await fetch("/", { cache: "no-store" });
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    for (const id of SECTION_IDS) {
      const el = doc.getElementById(id);
      if (!el || el.tagName !== "SECTION") continue;
      // The section id stays (some styles target it, e.g. #hero); inner ids are dropped.
      el.removeAttribute("hidden");
      el.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      sectionPreviews[id] = el.outerHTML;
    }
  } catch {
    // Placeholders are fine.
  }
}

// --- Boot ---

async function boot() {
  try {
    server = await loadState();
  } catch (e) {
    document.getElementById("app")!.replaceChildren(
      h("div", { class: "adm-fatal" }, h("h1", {}, "Can't open the editor"), h("p", {}, (e as Error).message))
    );
    return;
  }
  server.pages.sort((a, b) => (isHome(a) ? -1 : isHome(b) ? 1 : 0));
  baseVersion = server.version;
  pages = clone(server.pages);
  const restored = restoreDraft();

  mountSkeleton();
  await loadSectionPreviews();
  selectPage(pages.find(isHome)!);

  let justPublished: string | null = null;
  try {
    justPublished = sessionStorage.getItem(PUBLISHED_FLAG);
    sessionStorage.removeItem(PUBLISHED_FLAG);
  } catch {
    // ignore
  }
  if (justPublished !== null) showPublished(justPublished || undefined);
  else if (restored && isDirty()) toast("Restored your unpublished changes from last time.", "info");
}

boot();
