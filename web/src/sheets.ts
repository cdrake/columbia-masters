import Papa from "papaparse";
import { SHEET_URLS } from "./config";
import type { SiteEvent, ScheduleEntry, BoardMember, SiteContent } from "./types";

async function fetchSheet<T>(url: string): Promise<T[]> {
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

export async function fetchAllSheets() {
  const [events, schedule, board, content] = await Promise.all([
    fetchEvents(),
    fetchSchedule(),
    fetchBoard(),
    fetchContent(),
  ]);
  return { events, schedule, board, content };
}
