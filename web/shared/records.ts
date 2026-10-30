// Records query for GET /api/records — shared by the Pages Function and the dev
// server so both answer identically. Pure and browser-safe (no node imports).
//
// The records file holds one row per (event, course, gender, age group, year):
// the club's top time that season. best=1 collapses those to the all-time club
// record for each combination.

export interface TeamRecord {
  id: string;
  team: string;
  event: string;
  course: string;
  gender: string;
  ageGroup: string;
  time: string;
  timeInSeconds: number;
  swimmer: string;
  /** Permanent USMS member ID, when scraped. */
  swimmerId?: string | null;
  date: string | null;
  meet: string;
  year: string;
}

export interface RecordsQuery {
  /** USMS club code (state sites hold every club's swims). */
  team?: string;
  event?: { distance?: number; stroke?: string };
  course?: string;
  gender?: string;
  ageGroup?: string;
  year?: string;
  swimmer?: string;
  meet?: string;
  best: boolean;
  limit: number;
}

export interface RecordsResponse {
  team: string;
  query: Record<string, string>;
  /** Matches before `limit` was applied. */
  total: number;
  count: number;
  records: TeamRecord[];
}

export const PARAMS = ["team", "event", "course", "gender", "ageGroup", "age", "year", "swimmer", "meet", "best", "limit"];
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

const STROKES: Record<string, string> = {
  free: "freestyle",
  freestyle: "freestyle",
  fr: "freestyle",
  back: "backstroke",
  backstroke: "backstroke",
  bk: "backstroke",
  breast: "breaststroke",
  breaststroke: "breaststroke",
  br: "breaststroke",
  fly: "butterfly",
  butterfly: "butterfly",
  im: "individual medley",
  medley: "individual medley",
  "individual medley": "individual medley",
};

const COURSES: Record<string, string> = { scy: "scy", scm: "scm", lcm: "lcm", y: "scy", yards: "scy" };
const GENDERS: Record<string, string> = {
  men: "men",
  man: "men",
  m: "men",
  male: "men",
  women: "women",
  woman: "women",
  w: "women",
  f: "women",
  female: "women",
};

/** "50 free", "50 Y Freestyle", "100IM", "back" → distance and/or canonical stroke. */
export function parseEvent(raw: string): RecordsQuery["event"] | null {
  const m = raw
    .toLowerCase()
    .replace(/[_+-]/g, " ")
    .trim()
    .match(/^(\d+)?\s*(?:(?:y|yd|yds|yards?|m|meters?|metres?)\b)?\s*(.*)$/);
  if (!m) return null;
  const distance = m[1] ? Number(m[1]) : undefined;
  const strokeText = m[2].replace(/\s+/g, " ").trim();
  const stroke = strokeText ? STROKES[strokeText] : undefined;
  if (strokeText && !stroke) return null;
  if (distance === undefined && !stroke) return null;
  return { distance, stroke };
}

/** Age 42 → "40-44" (USMS 5-year groups from 18-24). */
export function ageGroupFor(age: number): string | null {
  if (!Number.isInteger(age) || age < 18 || age > 120) return null;
  if (age < 25) return "18-24";
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}`;
}

/** Validate URL search params; returns the query or a list of problems for a 400. */
export function parseQuery(params: URLSearchParams): { query: RecordsQuery } | { errors: string[] } {
  const errors: string[] = [];
  const get = (k: string) => params.get(k)?.trim() || undefined;
  const q: RecordsQuery = { best: false, limit: DEFAULT_LIMIT };

  for (const key of params.keys()) {
    if (!PARAMS.includes(key)) errors.push(`unknown parameter "${key}" (allowed: ${PARAMS.join(", ")})`);
  }

  const team = get("team");
  if (team) {
    if (/^[A-Za-z0-9]{1,8}$/.test(team)) q.team = team.toUpperCase();
    else errors.push(`team "${team}": use a USMS club code like COLM`);
  }

  const event = get("event");
  if (event) {
    const parsed = parseEvent(event);
    if (parsed) q.event = parsed;
    else errors.push(`event "${event}": use a distance and/or stroke, e.g. "50 free", "200 IM", "backstroke"`);
  }

  const course = get("course");
  if (course) {
    q.course = COURSES[course.toLowerCase()];
    if (!q.course) errors.push(`course "${course}": use scy, scm or lcm`);
  }

  const gender = get("gender");
  if (gender) {
    q.gender = GENDERS[gender.toLowerCase()];
    if (!q.gender) errors.push(`gender "${gender}": use men or women`);
  }

  const ageGroup = get("ageGroup");
  const age = get("age");
  if (ageGroup && age) errors.push("use ageGroup or age, not both");
  if (ageGroup) {
    if (/^\d{2,3}-\d{2,3}$/.test(ageGroup)) q.ageGroup = ageGroup;
    else errors.push(`ageGroup "${ageGroup}": use a USMS group like 40-44`);
  } else if (age) {
    const group = ageGroupFor(Number(age));
    if (group) q.ageGroup = group;
    else errors.push(`age "${age}": use a whole number from 18`);
  }

  const year = get("year");
  if (year) {
    if (/^\d{4}$/.test(year)) q.year = year;
    else errors.push(`year "${year}": use a four-digit year`);
  }

  q.swimmer = get("swimmer")?.toLowerCase();
  q.meet = get("meet")?.toLowerCase();

  const best = get("best");
  if (best) {
    if (/^(1|true|yes)$/i.test(best)) q.best = true;
    else if (!/^(0|false|no)$/i.test(best)) errors.push(`best "${best}": use true or false`);
  }

  const limit = get("limit");
  if (limit) {
    const n = Number(limit);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT) q.limit = n;
    else errors.push(`limit "${limit}": use 1–${MAX_LIMIT}`);
  }

  return errors.length ? { errors } : { query: q };
}

function matchesEvent(event: string, want: NonNullable<RecordsQuery["event"]>): boolean {
  // Record events look like "100 Y Individual Medley".
  const m = event.toLowerCase().match(/^(\d+)\s+[ym]\s+(.+)$/);
  if (!m) return false;
  if (want.distance !== undefined && Number(m[1]) !== want.distance) return false;
  if (want.stroke && m[2] !== want.stroke) return false;
  return true;
}

/** Filter, optionally reduce to all-time bests, and sort fastest first within each event. */
export function queryRecords(records: TeamRecord[], q: RecordsQuery): { total: number; records: TeamRecord[] } {
  let rows = records.filter(
    (r) =>
      (!q.team || r.team === q.team) &&
      (!q.event || matchesEvent(r.event, q.event)) &&
      (!q.course || r.course === q.course) &&
      (!q.gender || r.gender === q.gender) &&
      (!q.ageGroup || r.ageGroup === q.ageGroup) &&
      (!q.year || r.year === q.year) &&
      (!q.swimmer || r.swimmer.toLowerCase().includes(q.swimmer)) &&
      (!q.meet || r.meet.toLowerCase().includes(q.meet))
  );

  if (q.best) {
    const fastest = new Map<string, TeamRecord>();
    for (const r of rows) {
      // Not r.id: it includes the team, and on a state site the best spans every club.
      const key = `${r.course}|${r.event}|${r.gender}|${r.ageGroup}`;
      const cur = fastest.get(key);
      // Ties go to the earlier swim — it set the record first.
      if (!cur || r.timeInSeconds < cur.timeInSeconds || (r.timeInSeconds === cur.timeInSeconds && r.year < cur.year)) {
        fastest.set(key, r);
      }
    }
    rows = [...fastest.values()];
  }

  const eventKey = (r: TeamRecord) => {
    const m = r.event.match(/^(\d+)\s+\S+\s+(.+)$/);
    return m ? `${m[2]}\0${m[1].padStart(5, "0")}` : r.event;
  };
  rows.sort(
    (a, b) =>
      a.course.localeCompare(b.course) ||
      eventKey(a).localeCompare(eventKey(b)) ||
      a.gender.localeCompare(b.gender) ||
      a.ageGroup.localeCompare(b.ageGroup) ||
      a.timeInSeconds - b.timeInSeconds
  );

  return { total: rows.length, records: rows.slice(0, q.limit) };
}

/** Echo of the normalized query, so callers can see how their input was read. */
export function describeQuery(q: RecordsQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.event) {
    out.event = [q.event.distance, q.event.stroke].filter((v) => v !== undefined).join(" ");
  }
  for (const k of ["team", "course", "gender", "ageGroup", "year", "swimmer", "meet"] as const) {
    if (q[k]) out[k] = q[k]!;
  }
  out.best = String(q.best);
  out.limit = String(q.limit);
  return out;
}

export function answer(team: string, records: TeamRecord[], params: URLSearchParams) {
  const parsed = parseQuery(params);
  if ("errors" in parsed) return { status: 400, body: { error: "Invalid query.", details: parsed.errors } };
  const { total, records: rows } = queryRecords(records, parsed.query);
  const body: RecordsResponse = { team, query: describeQuery(parsed.query), total, count: rows.length, records: rows };
  return { status: 200, body };
}
