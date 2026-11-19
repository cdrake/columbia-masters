import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_STORE_BUTTON, teamStoreForm, validateTeamStore, type TeamStore } from "../shared/team-store.ts";
import { buildContent, llmsTxt, type EventRow, type SiteManifest } from "../shared/content.ts";

const store: TeamStore = {
  label: "Team Store",
  action: "https://www.augustaswimsupply.com/verify_access.cfm",
  url: "https://www.augustaswimsupply.com/teams.cfm",
  fields: { txtUsername: "COLUMBIA", txtPassword: "MASTERS" },
};

test("validateTeamStore accepts a valid block", () => {
  assert.deepEqual(validateTeamStore(store), []);
  const { url: _, ...noUrl } = store;
  assert.deepEqual(validateTeamStore(noUrl), []);
});

test("validateTeamStore rejects bad blocks", () => {
  assert.deepEqual(validateTeamStore([]), ["teamStore must be an object"]);
  assert.deepEqual(validateTeamStore({ ...store, label: " " }), ["teamStore.label is required"]);
  assert.deepEqual(validateTeamStore({ ...store, action: "http://x.com/login" }), ["teamStore.action must be an https URL"]);
  assert.deepEqual(validateTeamStore({ ...store, url: "teams.cfm" }), ["teamStore.url must be an https URL"]);
  for (const fields of [{}, { a: 1 }, ["x"], null]) {
    assert.deepEqual(validateTeamStore({ ...store, fields }), ["teamStore.fields must map field name → string value"]);
  }
});

test("teamStoreForm is an escaped POST form", () => {
  assert.equal(
    teamStoreForm({ label: "A&B", action: "https://s.com/l?a=1&b=2", fields: { u: 'x"y' } }),
    '<form class="team-store-form" method="post" action="https://s.com/l?a=1&amp;b=2" target="_blank" rel="noopener">' +
      '<input type="hidden" name="u" value="x&quot;y"><button type="submit">A&amp;B</button></form>'
  );
  assert.match(teamStoreForm(store, EVENT_STORE_BUTTON), /<button type="submit">Shop the team store<\/button>/);
});

const ev = (url: string): EventRow => ({ date: "2099-01-01", endDate: "", title: "Suit sale", location: "", notes: "", url });
const manifest = (teamStore?: { url: string; login: string }): SiteManifest => ({
  club: {
    name: "C", shortName: "C", teamCode: "C", lmsc: "SC", description: "d", website: "https://c.org", pool: "",
    address: { street: "", city: "", region: "", postalCode: "" }, socials: [], documents: [],
    ...(teamStore ? { teamStore } : {}),
  },
  timeZone: "America/New_York", sheetUrls: {}, about: [], scheduleNote: "", coaches: [], pages: [],
  fallback: { schedule: [], events: [], board: [], faq: [], content: {} },
});
const content = (m: SiteManifest, events: EventRow[]) =>
  buildContent(m, { ...m.fallback, events }, "fallback", "2026-01-01");

test('"team-store" event url points agents at the store page', () => {
  const m = manifest({ url: store.url!, login: "COLUMBIA / MASTERS" });
  const c = content(m, [ev("team-store"), ev("https://x.org/meet")]);
  assert.deepEqual(c.events.map((e) => e.url), [store.url, "https://x.org/meet"]);
  assert.match(llmsTxt(m, c), /^- Team store \(login: COLUMBIA \/ MASTERS\) at https:\/\/www\.augustaswimsupply\.com\/teams\.cfm$/m);
});

test('"team-store" without a store gets no link; plain urls unchanged', () => {
  const m = manifest();
  const c = content(m, [ev("team-store"), ev("https://x.org/meet")]);
  assert.deepEqual(c.events.map((e) => e.url), ["", "https://x.org/meet"]);
  assert.doesNotMatch(llmsTxt(m, c), /Team store|## Links/);
});
