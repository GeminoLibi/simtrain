// Re-derive every logged natural d20 from the revealed seed: node verify_rolls.mjs test-session-export.json
import { readFileSync } from "fs"; import { d20, commit } from "./src/engine.js";
const s = JSON.parse(readFileSync(process.argv[2]));
const ok = (await commit(s.seed)) === s.seed_commit; let bad = ok ? 0 : 1;
console.log("seed commit matches:", ok);
for (const r of s.rolls) { const i = +r.id.slice(1); const d = []; for (let k = 0; k < r.draws.length; k++) d.push((await d20(s.seed, i, k)).value);
  console.log(r.id, "logged", r.draws, "recomputed", d, JSON.stringify(d) === JSON.stringify(r.draws) ? "OK" : (bad++, "MISMATCH"), r.tier); }
process.exit(bad ? 1 : 0);
