/** Tiny hyperscript helper: h("button", { class: "x", onclick }, "Label"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === "value" && "value" in el) {
      (el as HTMLInputElement).value = String(v);
    } else if (k === "checked" && "checked" in el) {
      (el as HTMLInputElement).checked = Boolean(v);
    } else {
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

let fieldSeq = 0;

/** Labelled form row; wires the label to the control. */
export function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  const id = control.id || `adm-f${++fieldSeq}`;
  control.id = id;
  return h(
    "div",
    { class: "adm-field" },
    h("label", { for: id }, label),
    control,
    help ? h("p", { class: "adm-help" }, help) : null
  );
}

export function textInput(value: string, oninput: (v: string) => void, attrs: Record<string, unknown> = {}) {
  return h("input", {
    type: "text",
    value,
    oninput: (e: Event) => oninput((e.target as HTMLInputElement).value),
    ...attrs,
  });
}

export function textArea(value: string, oninput: (v: string) => void, rows = 6) {
  return h("textarea", {
    rows,
    value,
    oninput: (e: Event) => oninput((e.target as HTMLTextAreaElement).value),
  });
}

export function select<T extends string>(
  value: T,
  options: [T, string][],
  onchange: (v: T) => void
): HTMLSelectElement {
  const el = h(
    "select",
    { onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value as T) },
    ...options.map(([v, label]) => h("option", { value: v }, label))
  );
  el.value = value;
  return el;
}

export function checkbox(label: string, checked: boolean, onchange: (v: boolean) => void): HTMLElement {
  return h(
    "label",
    { class: "adm-check" },
    h("input", {
      type: "checkbox",
      checked,
      onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked),
    }),
    " ",
    label
  );
}
