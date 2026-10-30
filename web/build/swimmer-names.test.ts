import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, groupSwimmers, lastName, nameSlug, type SwimRecord } from "./swimmer-names.ts";

const rec = (swimmer: string, swimmerId?: string, year = "2020"): SwimRecord => ({
  team: "SC", event: "50 Y Freestyle", course: "scy", gender: "women", ageGroup: "40-44",
  time: "30.00", timeInSeconds: 30, swimmer, meet: "Meet", year, swimmerId,
});

test("cleanName trims and collapses whitespace", () => {
  assert.equal(cleanName("  Erin  C   Moro "), "Erin C Moro");
});

test("nameSlug", () => {
  assert.equal(nameSlug("Mary-Kate O'Brien Jr."), "mary-kate-o-brien-jr");
  assert.equal(nameSlug("  Ann   B  "), "ann-b");
});

test("lastName skips suffixes", () => {
  assert.equal(lastName("John Smith Jr."), "Smith");
  assert.equal(lastName("Cher"), "Cher");
});

test("groups case/whitespace variants and shows the most common spelling", () => {
  const { swimmers } = groupSwimmers([
    rec("Erin  C Moro"), rec("Erin C Moro"), rec("Erin C Moro"),
    rec("kristi M panayotoff"), rec("Kristi M Panayotoff"),
  ]);
  assert.deepEqual(swimmers.map((s) => [s.name, s.slug, s.records.length]), [
    ["Erin C Moro", "erin-c-moro", 3],
    ["Kristi M Panayotoff", "kristi-m-panayotoff", 2],
  ]);
});

test("aliases merge, opt-out skips", () => {
  const { swimmers } = groupSwimmers(
    [rec("Bob Jones"), rec("Robert Jones"), rec("Hidden Person")],
    { "bob  jones": "Robert Jones" },
    ["hidden person"]
  );
  assert.deepEqual(swimmers.map((s) => [s.name, s.records.length]), [["Robert Jones", 2]]);
});

test("slug collisions get a numeric suffix and a warning", () => {
  const { swimmers, warnings } = groupSwimmers([rec("Ann-Marie Lee"), rec("Ann Marie Lee")]);
  assert.deepEqual(swimmers.map((s) => s.slug).sort(), ["ann-marie-lee", "ann-marie-lee-2"]);
  assert.match(warnings.join("\n"), /collision/);
});

test("middle-initial-only differences warn but don't merge", () => {
  const { swimmers, warnings } = groupSwimmers([rec("Erin Moro"), rec("Erin C Moro"), rec("Erin Smith Moro")]);
  assert.equal(swimmers.length, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"Erin C Moro", "Erin Moro"|"Erin Moro", "Erin C Moro"/);
});

test("same ID merges spellings; most recent name wins and old spellings redirect", () => {
  const { swimmers, warnings } = groupSwimmers([
    rec("Jane A Smith", "AB12C", "2015"), rec("Jane A Smith", "AB12C", "2016"),
    rec("Jane A Doe", "AB12C", "2022"),
    rec("Jane A Smith", undefined, "2014"), // no ID: joins by name
  ]);
  assert.equal(swimmers.length, 1);
  assert.deepEqual([swimmers[0].id, swimmers[0].name, swimmers[0].slug, swimmers[0].records.length],
    ["AB12C", "Jane A Doe", "jane-a-doe", 4]);
  assert.deepEqual(swimmers[0].oldSlugs, ["jane-a-smith"]);
  assert.deepEqual(warnings, []);
});

test("different IDs with one name: earliest swimmer keeps the plain slug, others get the ID", () => {
  const { swimmers, warnings } = groupSwimmers([
    rec("John Smith", "ZZ999", "2024"), rec("John Smith", "AA111", "2010"),
    rec("John Smith", undefined, "2018"), // ambiguous: two IDs share the name
  ]);
  assert.deepEqual(swimmers.map((s) => [s.slug, s.id, s.records.length]), [
    ["john-smith", "AA111", 1], ["john-smith-2", undefined, 1], ["john-smith-zz999", "ZZ999", 1],
  ]);
  assert.equal(warnings.length, 2);
});

test("middle-initial pairs with distinct IDs don't warn; opt-out by ID or any name", () => {
  assert.deepEqual(groupSwimmers([rec("Erin Moro", "X1"), rec("Erin C Moro", "X2")]).warnings, []);
  assert.deepEqual(groupSwimmers([rec("Old Name", "Q9", "2010"), rec("New Name", "Q9")], {}, ["old name"]).swimmers, []);
  assert.deepEqual(groupSwimmers([rec("Pat Lee", "Q9")], {}, ["q9"]).swimmers, []);
});
