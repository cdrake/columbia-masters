import {
  BLOCK_TYPES,
  SECTION_LABELS,
  type Background,
  type Block,
  type ButtonItem,
  type ContentBlock,
} from "../../shared/pages";
import { checkbox, field, h, select, textArea, textInput } from "./dom";
import { prepareUpload } from "./uploads";

export interface FormHooks {
  /** Block props changed: re-render its preview (form stays mounted). */
  changed(): void;
  /** Structure changed (e.g. a list item added): re-render the form too. */
  rebuild(): void;
}

const MARKDOWN_HELP = "**bold**, *italic*, [link text](https://…), - bullet list, blank line = new paragraph";

export function blockLabel(b: Block): string {
  if (b.type === "section") return SECTION_LABELS[b.id];
  return BLOCK_TYPES.find((t) => t.type === b.type)?.label ?? b.type;
}

export function blockForm(b: Block, hooks: FormHooks): HTMLElement {
  const wrap = h("div", { class: "adm-form" }, h("h2", {}, blockLabel(b)));

  if (b.type === "section") {
    wrap.append(
      h(
        "p",
        { class: "adm-help" },
        "Built-in section. Its content comes from the club's Google Sheet and site files, so it can be moved or hidden here but not edited."
      ),
      checkbox("Hide this section", !!b.hidden, (v) => {
        b.hidden = v || undefined;
        hooks.changed();
      })
    );
    return wrap;
  }

  wrap.append(...contentFields(b, hooks));
  wrap.append(
    field(
      "Background",
      select<Background>(b.background ?? "default", [["default", "Plain"], ["alt", "Shaded"]], (v) => {
        b.background = v === "default" ? undefined : v;
        hooks.changed();
      })
    ),
    checkbox("Hide this block (keeps it as a draft)", !!b.hidden, (v) => {
      b.hidden = v || undefined;
      hooks.changed();
    })
  );
  return wrap;
}

function contentFields(b: ContentBlock, hooks: FormHooks): HTMLElement[] {
  const set = <T extends object>(props: T, key: keyof T, optional = false) => (v: string) => {
    (props as Record<string, unknown>)[key as string] = optional && !v ? undefined : v;
    hooks.changed();
  };

  switch (b.type) {
    case "heading":
      return [
        field("Heading", textInput(b.props.text, set(b.props, "text"))),
        field("Subtitle (optional)", textInput(b.props.subtitle ?? "", set(b.props, "subtitle", true))),
      ];
    case "richText":
    case "callout":
      return [
        field("Title (optional)", textInput(b.props.title ?? "", set(b.props, "title", true))),
        field("Text", textArea(b.props.markdown, set(b.props, "markdown"), 10), MARKDOWN_HELP),
      ];
    case "image":
      return imageFields(b, hooks, set);
    case "buttons":
      return buttonsFields(b.props.items, hooks);
    case "embed":
      return [
        field(
          "Link",
          textInput(b.props.url, set(b.props, "url"), { placeholder: "https://www.youtube.com/watch?v=…" }),
          "Paste a YouTube video link, or the embed link from Google Maps (Share → Embed a map), Google Forms (Send → <>) or Google Calendar (Settings → Integrate)."
        ),
        field("Description (for screen readers)", textInput(b.props.title, set(b.props, "title"))),
        field(
          "Shape",
          select(b.props.aspect ?? "wide", [["wide", "Wide (video, map)"], ["tall", "Tall (form, calendar)"]], (v) => {
            b.props.aspect = v === "wide" ? undefined : v;
            hooks.changed();
          })
        ),
      ];
    case "divider":
      return [h("p", { class: "adm-help" }, "A thin line to separate content.")];
  }
}

function imageFields(
  b: Extract<ContentBlock, { type: "image" }>,
  hooks: FormHooks,
  set: <T extends object>(props: T, key: keyof T, optional?: boolean) => (v: string) => void
): HTMLElement[] {
  const status = h("p", { class: "adm-help" });
  const file = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/gif",
    onchange: async () => {
      const f = file.files?.[0];
      if (!f) return;
      status.textContent = "Preparing image…";
      try {
        b.props.src = await prepareUpload(f);
        if (!b.props.alt) b.props.alt = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        hooks.rebuild();
      } catch (e) {
        status.textContent = String((e as Error).message ?? e);
      }
    },
  });
  return [
    field("Upload an image", file, "Large photos are resized automatically. The image goes live when you publish."),
    status,
    field("…or image address", textInput(b.props.src, set(b.props, "src"), { placeholder: "/uploads/photo.jpg or https://…" })),
    field(
      "Description (alt text)",
      textInput(b.props.alt, set(b.props, "alt")),
      "Describe the image for people using screen readers."
    ),
    field("Caption (optional)", textInput(b.props.caption ?? "", set(b.props, "caption", true))),
    field(
      "Size",
      select(b.props.width ?? "wide", [["narrow", "Small"], ["wide", "Medium"], ["full", "Full width"]], (v) => {
        b.props.width = v;
        hooks.changed();
      })
    ),
  ];
}

function buttonsFields(items: ButtonItem[], hooks: FormHooks): HTMLElement[] {
  const rows = items.map((it, i) =>
    h(
      "fieldset",
      { class: "adm-fieldset" },
      h("legend", {}, `Button ${i + 1}`),
      field("Label", textInput(it.label, (v) => ((it.label = v), hooks.changed()))),
      field(
        "Link",
        textInput(it.url, (v) => ((it.url = v), hooks.changed()), { placeholder: "https://… or /page/ or mailto:…" })
      ),
      field(
        "Style",
        select(it.style ?? "primary", [["primary", "Gold (main)"], ["secondary", "Outline"]], (v) => {
          it.style = v;
          hooks.changed();
        })
      ),
      items.length > 1
        ? h(
            "button",
            { type: "button", class: "adm-link-btn", onclick: () => (items.splice(i, 1), hooks.rebuild()) },
            "Remove button"
          )
        : null
    )
  );
  return [
    ...rows,
    h(
      "button",
      {
        type: "button",
        class: "adm-secondary",
        onclick: () => (items.push({ label: "New button", url: "/", style: "secondary" }), hooks.rebuild()),
      },
      "+ Add button"
    ),
  ];
}
