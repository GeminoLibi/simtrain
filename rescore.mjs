import { score } from "./src/engine.js"; import fs from "fs";
for (const f of process.argv.slice(2)) { const s = JSON.parse(fs.readFileSync(f)); const r = score(s); console.log(f, r.total, JSON.stringify(r.domains)); }
