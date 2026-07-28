import Papa from "papaparse";
import tenant from "virtual:tenant";
import type { SiteEvent, ScheduleEntry, BoardMember, SiteContent, FAQEntry } from "./types";

const SHEET_URLS = tenant.sheetUrls;

async function fetchSheet<T>(url: string | undefined): Promise<T[]> {
  if (!url) return [];
  const res = await fetch(url);
  const csv = await res.text();
  const { data } = Papa.parse<T>(csv, { header: true, skipEmptyLines: true });
  return data;
}

export async function fetchEvents(): Promise<SiteEvent[]> {
  return fetchSheet<SiteEvent>(SHEET_URLS.events);
}

export async function fetchSchedule(): Promise<ScheduleEntry[]> {
  return fetchSheet<ScheduleEntry>(SHEET_URLS.schedule);
}

export async function fetchBoard(): Promise<BoardMember[]> {
  return fetchSheet<BoardMember>(SHEET_URLS.board);
}

export async function fetchContent(): Promise<Record<string, string>> {
  const rows = await fetchSheet<SiteContent>(SHEET_URLS.content);
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.key) map[row.key.trim()] = (row.value ?? "").trim();
  }
  return map;
}

/** FAQ tab is optional — tenants that haven't added it yet just get no gid, so this resolves to []. */
export async function fetchFAQ(): Promise<FAQEntry[]> {
  const rows = await fetchSheet<FAQEntry>(SHEET_URLS.faq);
  return rows.filter((r) => r.question?.trim() && r.answer?.trim());
}

export async function fetchAllSheets() {
  const [events, schedule, board, content, faq] = await Promise.all([
    fetchEvents(),
    fetchSchedule(),
    fetchBoard(),
    fetchContent(),
    fetchFAQ(),
  ]);
  return { events, schedule, board, content, faq };
}
