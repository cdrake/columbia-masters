// Swimmer-name grouping for /swimmers/ pages. No imports, so `node --test` can run it directly.

/** A top-times row, as in public/data/<teamCode>_all_records.json. */
export interface SwimRecord {
  team: string;
  event: string;
  course: string;
  gender: string;
  ageGroup: string;
  time: string;
  timeInSeconds: number | null;
  swimmer: string;
  meet: string;
  year: string | null;
  /** Permanent USMS member ID (the part after the dash of the registration number). */
  swimmerId?: string | null;
}

export interface Swimmer {
  /** USMS ID, when the records carry one. */
  id?: string;
  /** Display name: the most recent spelling in the group. */
  name: string;
  slug: string;
  /** Slugs of this swimmer's other spellings, redirected to `slug` (e.g. after a name change). */
  oldSlugs: string[];
  records: SwimRecord[];
}

/** Trim and collapse internal whitespace. */
export const cleanName = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ");

/** Lowercase, non-alphanumerics → "-", trimmed. */
export const nameSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Last name for A–Z sorting, skipping generational suffixes. */
export function lastName(name: string): string {
  const tokens = name.split(" ");
  while (tokens.length > 1 && /^(jr|sr|ii|iii|iv)\.?$/i.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens[tokens.length - 1];
}

const capitals = (s: string) => s.replace(/[^A-Z]/g, "").length;
const yearOf = (r: SwimRecord) => Number(r.year) || 0;

/**
 * Group records by swimmer. Records with a USMS ID group by it; records without one join the
 * ID group whose name matches (cleaned, aliased, case-insensitive) when exactly one does,
 * otherwise group by name. An alias keyed by a USMS ID maps it to another ID (one person,
 * two registrations). The display name is the most recent spelling. Slugs come from the
 * name; when swimmers share one, the one with the earliest swim keeps it and the others get
 * their ID appended (or -2, -3… without an ID), so established URLs never move. Opted-out
 * swimmers (any of their names, or their ID) get no entry. Warns on slug collisions and on
 * names that differ only by a middle initial where an ID can't tell them apart.
 */
export function groupSwimmers(
  records: SwimRecord[],
  aliases: Record<string, string> = {},
  optOut: string[] = []
): { swimmers: Swimmer[]; warnings: string[] } {
  const alias = new Map(Object.entries(aliases).map(([k, v]) => [cleanName(k).toLowerCase(), cleanName(v)]));
  const skip = new Set(optOut.map((n) => cleanName(n).toLowerCase()));
  const ids = new Set(records.map((r) => r.swimmerId?.toUpperCase()).filter(Boolean));
  const idAlias = new Map(
    Object.entries(aliases)
      .filter(([k]) => ids.has(k.trim().toUpperCase()))
      .map(([k, v]) => [k.trim().toUpperCase(), v.trim().toUpperCase()])
  );
  const idOf = (r: SwimRecord) => (r.swimmerId && idAlias.get(r.swimmerId.toUpperCase())) || r.swimmerId;
  const nameOf = (r: SwimRecord) => {
    const raw = cleanName(r.swimmer);
    return alias.get(raw.toLowerCase()) ?? raw;
  };

  // Name → IDs seen with it, so ID-less records can find their swimmer.
  const idsByName = new Map<string, Set<string>>();
  for (const r of records) {
    const id = idOf(r);
    if (!id || !nameOf(r)) continue;
    const k = nameOf(r).toLowerCase();
    idsByName.set(k, (idsByName.get(k) ?? new Set()).add(id));
  }

  type Group = { id?: string; names: Set<string>; spellings: Map<string, { n: number; year: number }>; records: SwimRecord[] };
  const groups = new Map<string, Group>();
  for (const r of records) {
    const name = nameOf(r);
    if (!name) continue;
    const named = idsByName.get(name.toLowerCase());
    const id = idOf(r) || (named?.size === 1 ? [...named][0] : undefined);
    const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { id, names: new Set(), spellings: new Map(), records: [] }));
    const sp = g.spellings.get(name) ?? { n: 0, year: 0 };
    g.spellings.set(name, { n: sp.n + 1, year: Math.max(sp.year, yearOf(r)) });
    g.names.add(name.toLowerCase()).add(cleanName(r.swimmer).toLowerCase());
    g.records.push(r);
  }

  const kept = [...groups.values()]
    .filter((g) => !(g.id && skip.has(g.id.toLowerCase())) && ![...g.names].some((n) => skip.has(n)))
    .map((g) => ({
      ...g,
      name: [...g.spellings].sort(
        (a, b) => b[1].year - a[1].year || b[1].n - a[1].n || capitals(b[0]) - capitals(a[0])
      )[0][0],
      first: Math.min(...g.records.map(yearOf).filter(Boolean), 9999),
    }))
    .sort((a, b) => a.first - b.first || (a.id ?? "~").localeCompare(b.id ?? "~") || a.name.localeCompare(b.name));

  const warnings: string[] = [];
  const used = new Set<string>();
  const swimmers: Swimmer[] = [];
  for (const g of kept) {
    const base = nameSlug(g.name) || "swimmer";
    let slug = base;
    if (used.has(slug) && g.id) slug = `${base}-${g.id.toLowerCase()}`;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    if (slug !== base) warnings.push(`swimmer slug collision: "${g.name}" → /swimmers/${slug}/ (${base} taken)`);
    used.add(slug);
    swimmers.push({ ...(g.id && { id: g.id }), name: g.name, slug, oldSlugs: [...g.spellings.keys()].map(nameSlug), records: g.records });
  }
  // Old spellings redirect only when no live page uses that slug.
  for (const s of swimmers) s.oldSlugs = [...new Set(s.oldSlugs)].filter((o) => o && !used.has(o));
  swimmers.sort((a, b) => a.slug.localeCompare(b.slug));

  // "Erin Moro" vs "Erin C Moro": same first + last, middle tokens all single letters.
  // Two different IDs are two different people, so only warn when one side has no ID.
  const byInitials = new Map<string, Swimmer[]>();
  for (const s of swimmers) {
    const tokens = s.name.toLowerCase().split(" ");
    if (tokens.length < 2 || !tokens.slice(1, -1).every((t) => t.replace(".", "").length === 1)) continue;
    const sig = `${tokens[0]} ${tokens[tokens.length - 1]}`;
    byInitials.set(sig, [...(byInitials.get(sig) ?? []), s]);
  }
  for (const group of byInitials.values()) {
    if (new Set(group.map((s) => s.name)).size > 1 && group.some((s) => !s.id)) {
      warnings.push(`swimmer names differ only by middle initial (not merged): ${group.map((s) => `"${s.name}"`).join(", ")}`);
    }
  }
  return { swimmers, warnings };
}
