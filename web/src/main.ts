import type { TeamRecord } from "./types";
import "./style.css";

let allRecords: TeamRecord[] = [];
let sortKey: keyof TeamRecord = "time";
let sortAsc = true;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// --- Init ---

async function init() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/COLM_all_records.json`);
  allRecords = await res.json();

  populateFilters();
  wireEvents();
  updateSortIndicators();
  render();
}

// --- Filters ---

function populateFilters() {
  const unique = (key: keyof TeamRecord) =>
    [...new Set(allRecords.map((r) => String(r[key] ?? "")))].filter(Boolean).sort();

  fillSelect("filter-course", unique("course"));
  fillSelect("filter-gender", unique("gender"));
  fillSelect("filter-event", getStrokes());
  fillSelect("filter-distance", getDistances());
  fillSelect("filter-year", unique("year").sort((a, b) => b.localeCompare(a)));
  fillSelect("filter-age", unique("ageGroup"));
}

function fillSelect(id: string, values: string[]) {
  const sel = $<HTMLSelectElement>(`#${id}`);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = formatLabel(id, v);
    sel.appendChild(opt);
  }
}

function getStrokes(): string[] {
  const strokes = new Set<string>();
  for (const r of allRecords) {
    const stroke = extractStroke(r.event);
    if (stroke) strokes.add(stroke);
  }
  return [...strokes].sort();
}

function extractStroke(event: string): string {
  // Events like "50 Y Freestyle", "100 M Backstroke", "200 Y Individual Medley"
  const match = event.match(/\d+\s+[YM]\s+(.+)/i);
  return match ? match[1].trim() : event;
}

function getDistances(): string[] {
  const distances = new Set<string>();
  for (const r of allRecords) {
    const d = extractDistance(r.event);
    if (d) distances.add(d);
  }
  return [...distances].sort((a, b) => parseInt(a) - parseInt(b));
}

function extractDistance(event: string): string {
  const match = event.match(/^(\d+)\s/);
  return match ? match[1] : "";
}

function formatLabel(filterId: string, value: string): string {
  if (filterId === "filter-course") return value.toUpperCase();
  if (filterId === "filter-gender") return value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

// --- Events ---

function wireEvents() {
  $<HTMLInputElement>("#search").addEventListener("input", debounce(render, 150));

  for (const id of ["filter-course", "filter-gender", "filter-event", "filter-distance", "filter-year", "filter-age"]) {
    $<HTMLSelectElement>(`#${id}`).addEventListener("change", render);
  }

  for (const th of document.querySelectorAll<HTMLElement>("th[data-sort]")) {
    th.addEventListener("click", () => {
      const key = th.dataset.sort as keyof TeamRecord;
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = true;
      }
      updateSortIndicators();
      render();
    });
  }
}

function updateSortIndicators() {
  for (const th of document.querySelectorAll<HTMLElement>("th[data-sort]")) {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === sortKey) {
      th.classList.add(sortAsc ? "sort-asc" : "sort-desc");
    }
  }
}

// --- Filter + Sort + Render ---

function getFiltered(): TeamRecord[] {
  const query = $<HTMLInputElement>("#search").value.toLowerCase();
  const course = $<HTMLSelectElement>("#filter-course").value;
  const gender = $<HTMLSelectElement>("#filter-gender").value;
  const event = $<HTMLSelectElement>("#filter-event").value;
  const distance = $<HTMLSelectElement>("#filter-distance").value;
  const year = $<HTMLSelectElement>("#filter-year").value;
  const age = $<HTMLSelectElement>("#filter-age").value;

  return allRecords.filter((r) => {
    if (course && r.course !== course) return false;
    if (gender && r.gender !== gender) return false;
    if (event && extractStroke(r.event) !== event) return false;
    if (distance && extractDistance(r.event) !== distance) return false;
    if (age && r.ageGroup !== age) return false;
    if (year && r.year !== year) return false;
    if (query) {
      const haystack = `${r.swimmer} ${r.event} ${r.meet}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function getSorted(records: TeamRecord[]): TeamRecord[] {
  return [...records].sort((a, b) => {
    let cmp: number;
    if (sortKey === "time") {
      cmp = (a.timeInSeconds ?? 0) - (b.timeInSeconds ?? 0);
    } else {
      cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
    }
    return sortAsc ? cmp : -cmp;
  });
}

function render() {
  const filtered = getFiltered();
  const sorted = getSorted(filtered);

  const tbody = $<HTMLTableSectionElement>("#results tbody");
  tbody.innerHTML = sorted
    .map(
      (r) => `<tr>
      <td>${esc(r.event)}</td>
      <td>${esc(r.swimmer)}</td>
      <td class="time">${esc(r.time)}</td>
      <td>${esc(r.ageGroup)}</td>
      <td>${esc(r.course.toUpperCase())}</td>
      <td>${esc(capitalize(r.gender))}</td>
      <td>${esc(r.year ?? "")}</td>
      <td>${esc(r.meet)}</td>
    </tr>`
    )
    .join("");

  $<HTMLSpanElement>("#record-count").textContent =
    `Showing ${sorted.length} of ${allRecords.length} records`;
}

// --- Helpers ---

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function debounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// --- Mobile nav ---

function wireMobileNav() {
  const toggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
  const links = document.querySelector<HTMLUListElement>(".nav-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", () => links.classList.toggle("open"));

  for (const a of links.querySelectorAll("a")) {
    a.addEventListener("click", () => links.classList.remove("open"));
  }
}

// --- Go ---
wireMobileNav();
init();
