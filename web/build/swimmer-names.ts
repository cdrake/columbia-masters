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
}

export interface Swimmer {
  /** Display name: the most common spelling in the group. */
  name: string;
  slug: string;
  /** Every `swimmer` string (as written in the records) that maps to this swimmer. */
  rawNames: string[];
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

/** Ties go to the spelling with more capitals ("Kristi M Panayotoff" over "kristi M panayotoff"). */
const capitals = (s: string) => s.replace(/[^A-Z]/g, "").length;

/**
 * Group records by swimmer: names are cleaned, aliased (variant → canonical) and compared
 * case-insensitively. Opted-out names (raw or canonical) get no swimmer entry. Returns
 * swimmers in slug order plus build warnings for slug collisions and names that differ
 * only by a middle initial (those are reported, never merged).
 */
export function groupSwimmers(
  records: SwimRecord[],
  aliases: Record<string, string> = {},
  optOut: string[] = []
): { swimmers: Swimmer[]; warnings: string[] } {
  const alias = new Map(Object.entries(aliases).map(([k, v]) => [cleanName(k).toLowerCase(), cleanName(v)]));
  const skip = new Set(optOut.map((n) => cleanName(n).toLowerCase()));

  const groups = new Map<string, { spellings: Map<string, number>; raw: Set<string>; records: SwimRecord[] }>();
  for (const r of records) {
    const raw = cleanName(r.swimmer);
    if (!raw) continue;
    const name = alias.get(raw.toLowerCase()) ?? raw;
    const key = name.toLowerCase();
    if (skip.has(key) || skip.has(raw.toLowerCase())) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { spellings: new Map(), raw: new Set(), records: [] }));
    g.spellings.set(name, (g.spellings.get(name) ?? 0) + 1);
    g.raw.add(r.swimmer);
    g.records.push(r);
  }

  const warnings: string[] = [];
  const used = new Set<string>();
  const swimmers: Swimmer[] = [];
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!;
    const name = [...g.spellings].sort((a, b) => b[1] - a[1] || capitals(b[0]) - capitals(a[0]))[0][0];
    const base = nameSlug(name) || "swimmer";
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    if (slug !== base) warnings.push(`swimmer slug collision: "${name}" → /swimmers/${slug}/ (${base} taken)`);
    used.add(slug);
    swimmers.push({ name, slug, rawNames: [...g.raw], records: g.records });
  }
  swimmers.sort((a, b) => a.slug.localeCompare(b.slug));

  // "Erin Moro" vs "Erin C Moro": same first + last, middle tokens all single letters.
  const byInitials = new Map<string, string[]>();
  for (const s of swimmers) {
    const tokens = s.name.toLowerCase().split(" ");
    if (tokens.length < 2 || !tokens.slice(1, -1).every((t) => t.replace(".", "").length === 1)) continue;
    const sig = `${tokens[0]} ${tokens[tokens.length - 1]}`;
    byInitials.set(sig, [...(byInitials.get(sig) ?? []), s.name]);
  }
  for (const names of byInitials.values()) {
    if (names.length > 1) {
      warnings.push(`swimmer names differ only by middle initial (not merged): ${names.map((n) => `"${n}"`).join(", ")}`);
    }
  }
  return { swimmers, warnings };
}
