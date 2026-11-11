// Improper acts use a near-impossible check (nat 20 + confirm d20 >= 17) instead of an auto-fail cap.
import assert from "node:assert/strict";
import { resolve, luckClass, score, d20, IMPOSSIBLE_CONFIRM, rollLine } from "../src/engine.js";

function baseState(seed, extra = {}) {
  return { rolls: [], friction_clock: 0, momentum: 0, turn: 1, turn_minutes: 5,
    profile: { experience: "Experienced" }, fundamentals: [], traps: [], seed, ...extra };
}
const cls = (o = {}) => ({
  summary: "Serve the chicken held out of temperature", difficulty: "standard", prohibited: true,
  rule_violated: "FDA Food Code time/temperature", rubric: { procedure: 3, framework: 3, specificity: 3 },
  fundamentals_required_missing: [], elapsed_minutes: 5, ...o
});
async function findSeed({ idx = 1, nat, confirm, confirmMin, confirmMax } = {}) {
  for (let i = 0; i < 80000; i++) {
    const seed = "s" + i.toString(16).padStart(6, "0");
    const a = await d20(seed, idx, 0);
    if (nat != null && a.value !== nat) continue;
    if (confirm != null || confirmMin != null || confirmMax != null) {
      const c = await d20(seed, idx, 2);
      if (confirm != null && c.value !== confirm) continue;
      if (confirmMin != null && c.value < confirmMin) continue;
      if (confirmMax != null && c.value > confirmMax) continue;
    }
    return seed;
  }
  throw new Error("no seed found");
}

let ok = 0, n = 0;
async function t(name, fn) {
  n++;
  await fn();
  ok++;
  console.log("PASS", name);
}

await t("near-impossible DC: a high but non-20 roll on an improper act fails", async () => {
  const seed = await findSeed({ nat: 19 });
  const roll = await resolve(baseState(seed), cls());
  assert.equal(roll.natural, 19);
  assert.equal(roll.prohibited, true);
  assert.equal(roll.confirm, null);
  assert.equal(roll.tier, "failure");
  assert.ok(roll.total >= 12, "this roll would have succeeded without the near-impossible check");
  assert.ok(roll.effects.some(e => /improper/.test(e) && /FAILS/.test(e)));
  assert.match(rollLine(roll), /near-impossible DC/);
});

await t("near-impossible DC: natural 20 with a weak confirm still fails", async () => {
  const seed = await findSeed({ nat: 20, confirmMax: IMPOSSIBLE_CONFIRM - 1 });
  const roll = await resolve(baseState(seed), cls());
  assert.equal(roll.natural, 20);
  assert.ok(roll.confirm < IMPOSSIBLE_CONFIRM);
  assert.equal(roll.tier, "failure");
  assert.equal(luckClass(roll), null);
});

await t("near-impossible DC: natural 20 plus confirm 17+ succeeds, never as a critical success", async () => {
  const seed = await findSeed({ nat: 20, confirmMin: IMPOSSIBLE_CONFIRM });
  const roll = await resolve(baseState(seed), cls());
  assert.equal(roll.natural, 20);
  assert.ok(roll.confirm >= IMPOSSIBLE_CONFIRM);
  assert.equal(roll.tier, "success");
  assert.notEqual(roll.tier, "critical_success");
  assert.equal(luckClass(roll), "lucky");
  assert.ok(roll.effects.some(e => /improper/.test(e) && /Against the odds/.test(e)));
  assert.ok(roll.effects.some(e => /concrete realistic consequence/.test(e)));
  assert.doesNotMatch(roll.effects.join(" "), /Normal progression|Flawless execution/);
  assert.match(rollLine(roll), /near-impossible success/);
  assert.match(rollLine(roll), new RegExp("confirm d20 " + roll.confirm));
});

await t("mastery floor does not legitimize an improper act", async () => {
  const seed = await findSeed({ nat: 5 });
  const roll = await resolve(baseState(seed), cls());
  assert.equal(roll.natural, 5);
  assert.equal(roll.floor_applied, false);
  assert.equal(roll.tier, "failure");
});

await t("a non-prohibited high roll is unchanged", async () => {
  const seed = await findSeed({ nat: 19 });
  const roll = await resolve(baseState(seed), cls({ prohibited: false, rule_violated: null, summary: "Discard the out-of-temp chicken and log it" }));
  assert.equal(roll.natural, 19);
  assert.ok(["success", "critical_success"].includes(roll.tier));
  assert.equal(roll.prohibited, false);
});

await t("score still flags an improper act that happened to work", async () => {
  const roll = { id: "R1", action: "Serve the chicken held out of temperature", tier: "success", prohibited: true,
    rule_violated: "FDA Food Code time/temperature", traps_triggered: [],
    mod_parts: { procedure: 3, framework: 3, specificity: 3, prereq_penalty: 0 } };
  assert.equal(luckClass(roll), "lucky");
  const sc = score({ fundamentals: [], satisfied: [], traps: [], artifacts: [], rolls: [roll], grader: [] });
  assert.equal(sc.detail.compliance.prohibited_penalty, -4);
  assert.ok(sc.domains.compliance < 8, "baseline 8 is reduced by the prohibited penalty");
});

console.log(`${ok}/${n} passed`);
process.exit(ok === n ? 0 : 1);
