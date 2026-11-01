import test from "node:test";
import assert from "node:assert/strict";
import { learnCrowd, blendLearned } from "./src/services/crowdService.js";

const base = { pct: 40, level: "low", source: "ml", modelData: "synthetic" };

test("no learned data: the general estimate is returned unchanged", () => {
  assert.deepEqual(blendLearned(base, "r_none", 1, 9), base);
});

test("fewer than 5 real counts are ignored", () => {
  for (let i = 0; i < 4; i++) learnCrowd({ routeId: "r_few", weekday: 1, hour: 9, pct: 100 });
  assert.equal(blendLearned(base, "r_few", 1, 9).pct, 40);
});

test("enough real counts pull the estimate towards this route's own numbers", () => {
  for (let i = 0; i < 20; i++) learnCrowd({ routeId: "r_busy", weekday: 2, hour: 9, pct: 90 });
  const v = blendLearned(base, "r_busy", 2, 9); // weight = 20/30 = 0.667
  assert.equal(v.source, "learned");
  assert.equal(v.pct, Math.round(0.6667 * 90 + 0.3333 * 40));
  assert.equal(v.level, "medium"); // 73%
  assert.equal(blendLearned(base, "r_busy", 2, 10).pct, 40); // another hour: untouched
  assert.equal(blendLearned(base, "r_busy", 6, 9).pct, 40); // weekend is kept apart from weekdays
  assert.equal(blendLearned(base, "r_other", 2, 9).pct, 40); // another route: untouched
});

test("the learned weight never exceeds 80%", () => {
  for (let i = 0; i < 1000; i++) learnCrowd({ routeId: "r_many", weekday: 0, hour: 18, pct: 100 });
  assert.equal(blendLearned(base, "r_many", 0, 18).pct, Math.round(0.8 * 100 + 0.2 * 40));
});