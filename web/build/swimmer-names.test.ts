import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, groupSwimmers, lastName, nameSlug, type SwimRecord } from "./swimmer-names.ts";

const rec = (swimmer: string): SwimRecord => ({
  team: "SC", event: "50 Y Freestyle", course: "scy", gender: "women", ageGroup: "40-44",
  time: "30.00", timeInSeconds: 30, swimmer, meet: "Meet", year: "2020",
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
  assert.deepEqual(swimmers[0].rawNames.sort(), ["Erin  C Moro", "Erin C Moro"]);
});

test("aliases merge, opt-out skips", () => {
  const { swimmers } = groupSwimmers(
    [rec("Bob Jones"), rec("Robert Jones"), rec("Hidden Person")],
    { "bob  jones": "Robert Jones" },
    ["hidden person"]
  );
  assert.deepEqual(swimmers.map((s) => [s.name, s.records.length, s.rawNames.length]), [["Robert Jones", 2, 2]]);
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
