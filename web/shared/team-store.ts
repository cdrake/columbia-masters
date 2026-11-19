// Optional tenant.json "teamStore": a vendor store whose login form must be POSTed
// (it has no deep link and refuses GET). Shared by the build, the runtime event cards
// and the agent content, so the markup can't drift. Pure and browser-safe.

export interface TeamStore {
  label: string;
  /** The store's login form action (https). */
  action: string;
  /** Hidden form fields, e.g. the shared team username/password. */
  fields: Record<string, string>;
  /** Store page for agents/humans who can't POST; defaults to action. */
  url?: string;
}

/** An Events Sheet url of exactly this shows the store button instead of a link. */
export const TEAM_STORE_KEYWORD = "team-store";
export const EVENT_STORE_BUTTON = "Shop the team store";

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isHttps = (v: unknown) => isStr(v) && /^https:\/\/[^\s"<>]+$/.test(v);

export function validateTeamStore(s: unknown): string[] {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return ["teamStore must be an object"];
  const t = s as Record<string, unknown>;
  const errs: string[] = [];
  if (!isStr(t.label)) errs.push("teamStore.label is required");
  if (!isHttps(t.action)) errs.push("teamStore.action must be an https URL");
  if (t.url !== undefined && !isHttps(t.url)) errs.push("teamStore.url must be an https URL");
  const f = t.fields;
  if (
    typeof f !== "object" || f === null || Array.isArray(f) || !Object.keys(f).length ||
    !Object.entries(f).every(([k, v]) => isStr(k) && typeof v === "string")
  ) {
    errs.push("teamStore.fields must map field name → string value");
  }
  return errs;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** POST form that logs into the store in the same tab: some in-app browsers drop the POST body for target=_blank. */
export function teamStoreForm(s: TeamStore, buttonText: string = s.label): string {
  const inputs = Object.entries(s.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<form class="team-store-form" method="post" action="${esc(s.action)}">${inputs}<button type="submit">${esc(buttonText)}</button></form>`;
}
