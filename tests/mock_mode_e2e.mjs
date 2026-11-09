// Keyless demo mode (MOCK_LLM=1, no META_API_KEY): a full session runs with NO network access at all.
// Bundle the worker to ./worker.js first (npm test does this).
import worker from "./worker.js";
import assert from "node:assert/strict";
import { d20, commit } from "../src/engine.js";
let netCalls = 0; globalThis.fetch = async () => { netCalls++; throw new Error("network must not be used in mock mode"); };
const kv = new Map();
const KV = { list: async () => ({ keys: [], list_complete: true }), get: async k => kv.get(k)?.v ?? null, put: async (k, v, o) => kv.set(k, { v, m: o?.metadata }), delete: async k => kv.delete(k), getWithMetadata: async k => ({ value: kv.get(k)?.v ?? null, metadata: kv.get(k)?.m }) };
const base = { KV, META_BASE: "http://unused", TEXT_MODEL: "t", IMAGE_MODEL: "i", SPEND_CAP_USD: "15" };
const call = async (env, p, body) => { const r = await worker.fetch(new Request("http://x" + p, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} }); return [r, await r.json().catch(() => null)]; };
let ok = 0; const t = (n, c) => { assert.ok(c, n); ok++; console.log("PASS", n); };

// 1) No key and no MOCK_LLM: a clear setup message, not a crash, and still no network.
{ const env = { ...base }; const [, s] = await call(env, "/api/session", {}); await call(env, `/api/session/${s.id}/turn`, { input: "simTrain" });
  const [, r] = await call(env, `/api/session/${s.id}/turn`, { input: "ROLE: cook\nEXPERIENCE_LEVEL: Experienced" });
  t("no key -> explains how to configure (META_API_KEY / MOCK_LLM)", r.state.transcript.some(m => /MOCK_LLM=1/.test(m.text))); }

// 2) MOCK_LLM=1: a full session end to end.
const env = { ...base, MOCK_LLM: "1" };
const [, s] = await call(env, "/api/session", {}); const T = i => call(env, `/api/session/${s.id}/turn`, { input: i });
await T("simTrain");
let [, r] = await T("ROLE: warehouse shift lead\nEXPERIENCE_LEVEL: Experienced");
t("scenario starts in play", r.state.phase === "play" && /Mock shift/.test(r.state.transcript.map(m => m.text).join("\n")));
[, r] = await T("I walk over to Dana, apologize for the wait and tell her I am checking both bookings against the schedule now.");
[, r] = await T("I call the vendor, confirm the second booking is a duplicate and ask them to cancel it, then write the reference number down.");
[, r] = await T("Continue");
[, r] = await T("I log the incident in the shift log with both booking numbers, the vendor reference and the time I called.");
[, r] = await T(".end");
const tx = r.state.transcript.map(m => m.text).join("\n");
t("scorecard computed", /## Scorecard/.test(tx));
t("roll audit with seed reveal", /## Roll audit/.test(tx));
t("mock debrief present", /mock model/i.test(tx));
const [, ej] = await call(env, `/api/session/${s.id}/export`);
t("export has seed + rolls", !!ej.seed && ej.rolls.length >= 3);
t("seed matches commitment", (await commit(ej.seed)) === ej.seed_commit);
for (const roll of ej.rolls) { const i = +roll.id.slice(1); const d = []; for (let k = 0; k < roll.draws.length; k++) d.push((await d20(ej.seed, i, k)).value); assert.deepEqual(d, roll.draws, "roll " + roll.id + " re-derives"); }
t("every roll re-derives from the seed", true);
t("zero network calls", netCalls === 0);
t("zero spend", !kv.has("spend:total") || parseFloat(kv.get("spend:total").v) === 0);
console.log(`${ok} passed`);
