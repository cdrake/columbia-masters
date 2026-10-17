// Club content for agents: GET /api/content, the live /llms.txt and /openapi.json.
// Shared by the build (static fallbacks), the dev server and the Pages Functions
// so all three answer identically. Pure and browser-safe (no node imports).
//
// The club's Google Sheet is the source of truth for schedule, events, board, FAQ
// and site copy. `hatch run sync-content` snapshots it into
// tenants/<slug>/content/fallback/*.json (same row shapes as below), which the
// build bakes into the HTML and data/site.json. The Functions read the live Sheet
// and fall back to that snapshot per tab.

// --- Sheet rows (also the fallback file shapes) ---

export interface ScheduleRow {
  day: string;
  time: string;
  location?: string;
  /** e.g. "Open Pool" / "Closed Pool"; optional Sheet column. */
  type?: string;
}

export interface EventRow {
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD, or "" for one-day events. */
  endDate: string;
  title: string;
  location: string;
  /** Inline markdown. */
  notes: string;
  url: string;
}

export interface BoardRow {
  role: string;
  name: string;
}

export interface FaqRow {
  question: string;
  /** Inline markdown. */
  answer: string;
}

export interface SheetData {
  schedule: ScheduleRow[];
  events: EventRow[];
  board: BoardRow[];
  faq: FaqRow[];
  /** Content tab key → value (hero_sub, about_text, schedule_note, alert_message, …). */
  content: Record<string, string>;
}

export const SHEET_TABS = ["schedule", "events", "board", "faq", "content"] as const;
export type SheetTab = (typeof SHEET_TABS)[number];

// --- Build manifest (data/site.json) ---

export interface ClubInfo {
  name: string;
  shortName: string;
  teamCode: string;
  lmsc: string;
  description: string;
  website: string;
  pool: string;
  address: { street: string; city: string; region: string; postalCode: string };
  socials: { label: string; url: string }[];
  documents: { label: string; url: string }[];
}

export interface SiteManifest {
  club: ClubInfo;
  /** IANA zone used to decide which events are still upcoming. */
  timeZone: string;
  /** Published-CSV URL per Sheet tab (faq is optional). */
  sheetUrls: Partial<Record<SheetTab, string>>;
  /** About paragraphs (markdown) from content/about.md, used when the Sheet has none. */
  about: string[];
  scheduleNote: string;
  coaches: { name: string; bio: string }[];
  /** Site pages, home first; paths are absolute ("/", "/workouts/"). */
  pages: { title: string; path: string; description?: string }[];
  /** Snapshot of the Sheet from content/fallback/. */
  fallback: SheetData;
}

// --- API response ---

export interface ClubContent {
  club: ClubInfo;
  /** Site-wide notice (pool closures etc.), or null. */
  alert: string | null;
  about: string[];
  scheduleNote: string;
  schedule: ScheduleRow[];
  /** Events that haven't ended yet, in Sheet order. */
  events: EventRow[];
  board: BoardRow[];
  faq: FaqRow[];
  coaches: { name: string; bio: string }[];
  /** Club-local date the event list was filtered against. */
  asOf: string;
  /** "sheet" = live Google Sheet; "fallback" = last snapshot; "partial" = some tabs from each. */
  source: "sheet" | "fallback" | "partial";
}

export const SECTIONS = [
  "club", "alert", "about", "schedule", "events", "board", "faq", "coaches",
] as const;
export type Section = (typeof SECTIONS)[number];

export const DEFAULT_TIME_ZONE = "America/New_York";

// --- CSV + normalization ---

/** RFC 4180 CSV → rows of header → value (Google's published CSV). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ""])));
}

const cell = (row: Record<string, unknown>, key: string) => String(row[key] ?? "").trim();

/**
 * Canonical row shapes for one tab, whether read from the Sheet or a fallback
 * file. Mirrored by _normalize_tab() in src/usms_scraper/cli.py; keep in step.
 */
export function normalizeTab(tab: "content", rows: Record<string, unknown>[]): Record<string, string>;
export function normalizeTab<T extends Exclude<SheetTab, "content">>(
  tab: T,
  rows: Record<string, unknown>[]
): SheetData[T];
export function normalizeTab(tab: SheetTab, rows: Record<string, unknown>[]): unknown {
  switch (tab) {
    case "schedule":
      return rows
        .map((r) => {
          const out: ScheduleRow = { day: cell(r, "day"), time: cell(r, "time") };
          if (cell(r, "location")) out.location = cell(r, "location");
          if (cell(r, "type")) out.type = cell(r, "type");
          return out;
        })
        .filter((r) => r.day);
    case "events":
      return rows
        .map((r) => ({
          date: cell(r, "date"),
          endDate: cell(r, "endDate"),
          title: cell(r, "title"),
          location: cell(r, "location"),
          notes: cell(r, "notes"),
          url: cell(r, "url"),
        }))
        .filter((r) => r.title);
    case "board":
      return rows.map((r) => ({ role: cell(r, "role"), name: cell(r, "name") })).filter((r) => r.name);
    case "faq":
      return rows
        .map((r) => ({ question: cell(r, "question"), answer: cell(r, "answer") }))
        .filter((r) => r.question && r.answer);
    case "content": {
      const map: Record<string, string> = {};
      for (const r of rows) if (cell(r, "key")) map[cell(r, "key")] = cell(r, "value");
      return map;
    }
  }
}

/**
 * Read every Sheet tab, falling back per tab to the snapshot when a tab can't be
 * fetched (network error, non-CSV reply such as an unpublished sheet's sign-in page).
 */
export async function loadSheetData(
  manifest: SiteManifest,
  fetchText: (url: string) => Promise<string | null>
): Promise<{ data: SheetData; source: ClubContent["source"] }> {
  const data = structuredClone(manifest.fallback);
  let live = 0;
  let tried = 0;
  await Promise.all(
    SHEET_TABS.map(async (tab) => {
      const url = manifest.sheetUrls[tab];
      if (!url) return;
      tried++;
      const csv = await fetchText(url).catch(() => null);
      if (csv === null) return;
      (data as unknown as Record<SheetTab, unknown>)[tab] = normalizeTab(tab as "events", parseCsv(csv));
      live++;
    })
  );
  const source = live === tried ? "sheet" : live === 0 ? "fallback" : "partial";
  return { data, source };
}

// --- Dates ---

/** Today's date (YYYY-MM-DD) in the club's time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Events whose end (or start) date is today or later; undated rows are kept, as on the site. */
export function upcomingEvents(events: EventRow[], today: string): EventRow[] {
  return events.filter((e) => {
    const end = ISO_DATE.test(e.endDate) ? e.endDate : e.date;
    return ISO_DATE.test(end) ? end >= today : true;
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Feb 27 – Mar 1, 2026" / "Aug 8, 2026"; raw text when not an ISO date. */
export function formatEventDates(e: EventRow): string {
  const fmt = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;
  if (!ISO_DATE.test(e.date)) return e.date;
  const year = e.date.slice(0, 4);
  if (!ISO_DATE.test(e.endDate) || e.endDate === e.date) return `${fmt(e.date)}, ${year}`;
  return `${fmt(e.date)} – ${fmt(e.endDate)}, ${e.endDate.slice(0, 4)}`;
}

// --- Assemble ---

/** About paragraphs: the Sheet's about_text, about_text_2, … else content/about.md. */
function aboutParagraphs(manifest: SiteManifest, content: Record<string, string>): string[] {
  // Same rule as renderContent() in src/main.ts: about_text switches the section to the Sheet.
  if (!content.about_text) return manifest.about;
  return ["about_text", "about_text_2", "about_text_3"].map((k) => content[k]).filter(Boolean);
}

export function buildContent(
  manifest: SiteManifest,
  data: SheetData,
  source: ClubContent["source"],
  today: string
): ClubContent {
  return {
    club: manifest.club,
    alert: data.content.alert_message?.trim() || null,
    about: aboutParagraphs(manifest, data.content),
    scheduleNote: data.content.schedule_note || manifest.scheduleNote,
    schedule: data.schedule,
    events: upcomingEvents(data.events, today),
    board: data.board,
    faq: data.faq,
    coaches: manifest.coaches,
    asOf: today,
    source,
  };
}

/** GET /api/content: whole document, one `section`, or `format=md`. */
export function answerContent(
  content: ClubContent,
  params: URLSearchParams,
  manifest: SiteManifest
): { status: number; contentType: "json" | "markdown"; body: string } {
  const errors: string[] = [];
  for (const key of params.keys()) {
    if (key !== "section" && key !== "format") errors.push(`unknown parameter "${key}" (use section, format)`);
  }
  const section = params.get("section");
  if (section !== null && !(SECTIONS as readonly string[]).includes(section)) {
    errors.push(`section must be one of: ${SECTIONS.join(", ")}`);
  }
  const format = params.get("format") ?? "json";
  if (format !== "json" && format !== "md") errors.push(`format must be json or md`);
  if (errors.length) {
    return { status: 400, contentType: "json", body: JSON.stringify({ error: "Bad request", details: errors }) };
  }
  if (format === "md") return { status: 200, contentType: "markdown", body: llmsTxt(manifest, content) };
  if (section) {
    const { asOf, source } = content;
    return {
      status: 200,
      contentType: "json",
      body: JSON.stringify({ [section]: content[section as Section], asOf, source }),
    };
  }
  return { status: 200, contentType: "json", body: JSON.stringify(content) };
}

// --- llms.txt ---

/** Markdown → plain-ish text for list items: keep links, drop line breaks. */
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();

export function llmsTxt(m: SiteManifest, c: ClubContent): string {
  const club = m.club;
  const d = club.website;
  const a = club.address;
  const out: string[] = [];
  out.push(`# ${club.name} (${club.teamCode})`, "");
  out.push(`> ${club.description}`, "");
  out.push(
    `Current club information is below, read from the club's Google Sheet ${
      c.source === "sheet" ? "(live)" : "(partly or wholly from the last saved copy)"
    } as of ${c.asOf}. For structured data use \`GET ${d}/api/content\`; for swim times use \`GET ${d}/api/records\` (see API below).`,
    ""
  );
  if (c.alert) out.push(`**Notice:** ${oneLine(c.alert)}`, "");

  out.push("## About", "");
  out.push(`- Team code: ${club.teamCode} (US Masters Swimming)`);
  out.push(`- LMSC: ${club.lmsc}`);
  if (club.pool) out.push(`- Pool: ${club.pool}, ${a.street}, ${a.city}, ${a.region} ${a.postalCode}`);
  out.push(`- Website: ${d}/`);
  out.push("");
  for (const p of c.about) out.push(oneLine(p), "");

  out.push("## Practice schedule", "");
  if (c.schedule.length) {
    for (const s of c.schedule) {
      const extra = [s.type, s.location].filter(Boolean).join(", ");
      out.push(`- ${s.day}: ${s.time}${extra ? ` (${extra})` : ""}`);
    }
  } else out.push("- No practices are listed right now.");
  if (c.scheduleNote) out.push("", oneLine(c.scheduleNote));
  out.push("");

  out.push("## Upcoming events", "");
  if (c.events.length) {
    for (const e of c.events) {
      const title = e.url ? `[${e.title}](${e.url})` : e.title;
      const extra = [e.location, e.notes && oneLine(e.notes)].filter(Boolean).join(" — ");
      out.push(`- ${formatEventDates(e)}: ${title}${extra ? ` — ${extra}` : ""}`);
    }
  } else out.push("- No upcoming events are listed right now.");
  out.push("");

  if (c.coaches.length) {
    out.push("## Coaches", "");
    for (const co of c.coaches) out.push(`- **${co.name}**: ${oneLine(co.bio)}`);
    out.push("");
  }

  if (c.board.length) {
    out.push("## Board", "");
    for (const b of c.board) out.push(`- ${b.role}: ${b.name}`);
    out.push("");
  }

  if (c.faq.length) {
    out.push("## FAQ", "");
    for (const f of c.faq) out.push(`### ${oneLine(f.question)}`, "", oneLine(f.answer), "");
  }

  const links = [...club.socials, ...club.documents];
  if (links.length) {
    out.push("## Links", "");
    for (const l of links) out.push(`- [${l.label}](${l.url.startsWith("/") ? d + l.url : l.url})`);
    out.push("");
  }

  out.push("## API", "");
  out.push(
    `- [OpenAPI spec](${d}/openapi.json): machine-readable description of both endpoints below.`,
    `- [Club content](${d}/api/content): \`GET /api/content\` returns this page's information as JSON \`{club, alert, about, scheduleNote, schedule, events, board, faq, coaches, asOf, source}\`. Optional \`section\` (${SECTIONS.join(", ")}) returns just that part, e.g. [${d}/api/content?section=schedule](${d}/api/content?section=schedule). \`format=md\` returns this markdown. Events are only those that haven't ended; dates are YYYY-MM-DD.`,
    `- [Records query](${d}/api/records?event=50+free&course=scy&gender=women&best=true): \`GET /api/records\` returns matching club top times as JSON \`{team, query, total, count, records}\` — prefer it to downloading the full file. Parameters (all optional): \`event\` (distance and/or stroke, e.g. "50 free", "200 IM", "backstroke"), \`course\` (scy/scm/lcm), \`gender\` (men/women), \`ageGroup\` (e.g. 40-44) or \`age\` (e.g. 42), \`year\`, \`swimmer\` and \`meet\` (name substrings), \`best=true\` (only the fastest matching swim per event/course/gender/age group — the club record when no year is given; otherwise one row per season), \`limit\` (default 100, max 1000). Bad parameters return 400 with details.`,
    ""
  );

  out.push("## Data files", "");
  out.push(
    `- [Data index](${d}/data/index.json): datasets, schemas and download URLs`,
    `- [All team records](${d}/data/${club.teamCode}_all_records.json): every ${club.teamCode} top time across SCY/SCM/LCM, events, genders and age groups`,
    `- [Site manifest](${d}/data/site.json): club details, page list and the last saved copy of the Sheet content`,
    ""
  );

  out.push("## Pages", "");
  for (const p of m.pages) out.push(`- [${p.title}](${d}${p.path})${p.description ? `: ${oneLine(p.description)}` : ""}`);
  out.push(`- [Sitemap](${d}/sitemap.xml)`, "");
  return out.join("\n");
}

// --- OpenAPI ---

export function openApi(m: SiteManifest): object {
  const d = m.club.website;
  const str = { type: "string" };
  const strings = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, str]));
  const record = {
    type: "object",
    properties: { ...strings("id", "team", "event", "course", "gender", "ageGroup", "time", "swimmer", "meet", "year"), timeInSeconds: { type: "number" }, date: { type: ["string", "null"] } },
  };
  const q = (name: string, description: string, schema: object = str) => ({ name, in: "query", required: false, description, schema });
  const error = { description: "Invalid parameters", content: { "application/json": { schema: { type: "object", properties: { error: str, details: { type: "array", items: str } } } } } };
  return {
    openapi: "3.1.0",
    info: {
      title: `${m.club.name} API`,
      version: "1.0.0",
      description: `Public, read-only data for ${m.club.name} (${m.club.teamCode}), a US Masters Swimming club. No authentication. CORS is open.`,
    },
    servers: [{ url: d }],
    paths: {
      "/api/content": {
        get: {
          operationId: "getClubContent",
          summary: "Club information: practice schedule, upcoming events, board, FAQ, coaches, notices",
          description: "Read live from the club's Google Sheet (falls back to the last saved copy; see `source`). Events include only those that haven't ended as of `asOf` (club-local date).",
          parameters: [
            q("section", "Return only this part of the document", { type: "string", enum: [...SECTIONS] }),
            q("format", "json (default) or md for the same content as markdown (identical to /llms.txt)", { type: "string", enum: ["json", "md"] }),
          ],
          responses: {
            "200": {
              description: "Club content",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      club: { type: "object" },
                      alert: { type: ["string", "null"], description: "Site-wide notice, e.g. a pool closure" },
                      about: { type: "array", items: str },
                      scheduleNote: str,
                      schedule: { type: "array", items: { type: "object", properties: strings("day", "time", "location", "type"), required: ["day", "time"] } },
                      events: { type: "array", items: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, endDate: { type: "string", description: "YYYY-MM-DD or empty" }, ...strings("title", "location", "notes", "url") } } },
                      board: { type: "array", items: { type: "object", properties: strings("role", "name") } },
                      faq: { type: "array", items: { type: "object", properties: strings("question", "answer") } },
                      coaches: { type: "array", items: { type: "object", properties: strings("name", "bio") } },
                      asOf: { type: "string", description: "YYYY-MM-DD" },
                      source: { type: "string", enum: ["sheet", "fallback", "partial"] },
                    },
                  },
                },
                "text/markdown": { schema: str },
              },
            },
            "400": error,
          },
        },
      },
      "/api/records": {
        get: {
          operationId: "queryRecords",
          summary: "Club top times (team records) by event, course, gender, age group, year, swimmer or meet",
          description: "Rows are each season's top club time per event/course/gender/age group. best=true keeps only the fastest matching swim per event/course/gender/age group (the club record when no year is given).",
          parameters: [
            q("event", 'Distance and/or stroke, e.g. "50 free", "200 IM", "backstroke"'),
            q("course", "Pool course", { type: "string", enum: ["scy", "scm", "lcm"] }),
            q("gender", "men or women", { type: "string", enum: ["men", "women"] }),
            q("ageGroup", 'USMS age group, e.g. "40-44"'),
            q("age", "Swimmer age; selects the matching age group", { type: "integer" }),
            q("year", "Four-digit season year", { type: "integer" }),
            q("swimmer", "Case-insensitive swimmer-name substring"),
            q("meet", "Case-insensitive meet-name substring"),
            q("best", "Only the fastest matching swim per event/course/gender/age group", { type: "boolean" }),
            q("limit", "Max rows (default 100)", { type: "integer", minimum: 1, maximum: 1000 }),
          ],
          responses: {
            "200": {
              description: "Matching records",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { team: str, query: { type: "object" }, total: { type: "integer" }, count: { type: "integer" }, records: { type: "array", items: record } },
                  },
                },
              },
            },
            "400": error,
          },
        },
      },
    },
  };
}
