// NUC stat sheets (docs/design/NUC-STAT-SHEETS.md, phase 1). Pure, deterministic code: the model writes a sheet once
// at scenario design; every number after that is owned here. Nothing in this file draws randomness, so the seeded
// d20 audit is unchanged and old exports verify exactly as before.
// Decisions (Markus 2026-11-09): relationship info is shown ONLY in the debrief; trust/mood RESET every new scenario.

export const STAT_KEYS = ["composure", "cooperation", "authority", "expertise", "suspicion"];
export const MAX_NUCS = 6, REL_MIN = -3, REL_MAX = 3, MAX_TURN_SWING = 2, NUC_DC_CAP = 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const str = (v, n = 120) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, n);
const list = (v, max, n = 120) => (Array.isArray(v) ? v : []).map(x => str(typeof x === "object" && x ? x.fact ?? x.text ?? "" : x, n)).filter(Boolean).slice(0, max);

// Starting attitude from free-text disposition (used when the designer omits start, and for old-shape NUCs).
export function dispositionStart(d) {
  const t = String(d || "").toLowerCase();
  const neg = /\b(hostile|uncooperative|angry|furious|evasive|defensive|suspicious|wary|resentful|combative|irate|distrust\w*|annoyed|impatient|rude)\b/.test(t);
  const pos = /\b(helpful|cooperative|friendly|eager|supportive|calm|trusting|warm|loyal|grateful)\b/.test(t);
  const upset = /\b(angry|furious|irate|panick\w*|distraught|upset|frantic|agitated)\b/.test(t);
  return { trust: neg && !pos ? -1 : pos && !neg ? 1 : 0, mood: upset ? -2 : neg && !pos ? -1 : pos && !neg ? 1 : 0 };
}

// Validate + clamp the designer's sheets. Old-shape NUCs ({name, role, disposition}) get defaults.
export function sanitizeNucs(nucs) {
  const seen = new Set();
  return (Array.isArray(nucs) ? nucs : []).filter(n => n && typeof n === "object" && str(n.name)).slice(0, MAX_NUCS).map((n, i) => {
    let id = str(n.id, 8).toUpperCase(); if (!/^N\d{1,2}$/.test(id) || seen.has(id)) id = "N" + (i + 1); while (seen.has(id)) id = "N" + (parseInt(id.slice(1)) + 1); seen.add(id);
    const st = n.stats && typeof n.stats === "object" ? n.stats : {};
    const stats = Object.fromEntries(STAT_KEYS.map(k => [k, clamp(int(st[k], 2), 0, 5)]));
    const ds = dispositionStart(n.disposition), s0 = n.start && typeof n.start === "object" ? n.start : {};
    const secrets = (Array.isArray(n.secrets) ? n.secrets : []).slice(0, 2).map((x, j) => ({ id: "S" + (j + 1), fact: str(typeof x === "object" && x ? x.fact : x), reveal_dc: clamp(int(x?.reveal_dc, 15), 10, 25) })).filter(x => x.fact);
    return { id, name: str(n.name, 60), role: str(n.role, 80), disposition: str(n.disposition), stats,
      goals: list(n.goals, 3), hidden_goal: str(n.hidden_goal) || null, secrets, knows: list(n.knows, 6), doesnt_know: list(n.doesnt_know, 6),
      start: { trust: clamp(int(s0.trust, ds.trust), REL_MIN, REL_MAX), mood: clamp(int(s0.mood, ds.mood), REL_MIN, REL_MAX) } };
  });
}

// Fresh relationship state for a NEW scenario (decision 2: always reset). Difficulty shifts starting trust.
export function initNucState(sheets, difficulty) {
  const shift = { gentle: 1, hard: -1 }[difficulty] || 0;
  return Object.fromEntries((sheets || []).map(n => { const t = clamp(n.start.trust + shift, REL_MIN, REL_MAX); return [n.id, { trust: t, mood: n.start.mood, start_trust: t, start_mood: n.start.mood, history: [] }]; }));
}

const sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
// DC contribution of the target NUC: authority makes them harder to move, trust eases or hardens, an upset NUC adds +1.
export function nucDcPart(sheet, rel) {
  if (!sheet || !rel) return 0;
  return clamp(Math.round((sheet.stats.authority - 2) / 2) - sign(rel.trust) + (rel.mood <= -2 ? 1 : 0), -NUC_DC_CAP, NUC_DC_CAP);
}
export function nucAdvantage(sheet, rel, cls) {
  if (!sheet || !rel) return { adv: false, dis: false, why: null };
  if (rel.trust >= 2) return { adv: true, dis: false, why: `${sheet.name} trusts you` };
  if (rel.trust <= -2) return { adv: false, dis: true, why: `${sheet.name} distrusts you` };
  if (sheet.stats.suspicion >= 4 && cls?.unverified_claim === true) return { adv: false, dis: true, why: `${sheet.name} doubts an unbacked claim` };
  return { adv: false, dis: false, why: null };
}
export function findTarget(state, cls) {
  const id = String(cls?.target_nuc || "").toUpperCase(), sheets = state.nuc_sheets || [];
  const sheet = sheets.find(n => n.id === id) || (cls?.target_nuc ? sheets.find(n => n.name.toLowerCase() === String(cls.target_nuc).toLowerCase()) : null);
  return sheet ? { sheet, rel: state.nuc_state?.[sheet.id] } : null;
}

// Per-turn deltas, applied in code. Base by tier for the target; improper/egregious acts cost trust with everyone.
export const TIER_DELTA = { critical_success: [1, 1], success: [1, 0], friction: [0, -1], failure: [-1, -1], critical_failure: [-2, -2] };
export function applyNucTurn(state, { roll = null, cls = {}, kind = "action", graderComm = 0 } = {}) {
  const ns = state.nuc_state; if (!ns || !Object.keys(ns).length) return [];
  const d = Object.fromEntries(Object.keys(ns).map(id => [id, { t: 0, m: 0, why: [] }]));
  const tgt = findTarget(state, cls);
  if (kind === "continue") {
    for (const [id, r] of Object.entries(ns)) { const m = sign(r.start_mood - r.mood); if (m) { d[id].m += m; d[id].why.push("time passed; mood settles"); } }
  } else if (roll && tgt) {
    const [t, m] = TIER_DELTA[roll.tier] || [0, 0]; d[tgt.sheet.id].t += t; d[tgt.sheet.id].m += m; if (t || m) d[tgt.sheet.id].why.push(`${roll.id} ${roll.tier.replace(/_/g, " ")}`);
  } else if (!roll && tgt && kind === "freeform" && graderComm) {
    d[tgt.sheet.id].m += sign(graderComm); d[tgt.sheet.id].why.push(graderComm > 0 ? "handled the conversation well" : "handled the conversation poorly");
  }
  if (roll?.prohibited || cls?.egregious === true) for (const id of Object.keys(ns)) { d[id].t -= 1; d[id].why.push(cls?.egregious === true ? "egregious act witnessed" : "improper act"); }
  const changed = [];
  for (const [id, x] of Object.entries(d)) {
    const r = ns[id], dt = clamp(x.t, -MAX_TURN_SWING, MAX_TURN_SWING), dm = clamp(x.m, -MAX_TURN_SWING, MAX_TURN_SWING);
    const nt = clamp(r.trust + dt, REL_MIN, REL_MAX), nm = clamp(r.mood + dm, REL_MIN, REL_MAX);
    if (nt === r.trust && nm === r.mood) continue;
    r.history.push({ turn: state.turn, roll: roll?.id || null, d_trust: nt - r.trust, d_mood: nm - r.mood, trust: nt, mood: nm, why: x.why.join("; ").slice(0, 160) });
    if (r.history.length > 40) r.history.shift();
    r.trust = nt; r.mood = nm; changed.push(id);
  }
  return changed;
}

// Words only (no numbers) for the MODEL's context; never sent to the trainee during play.
export const trustLabel = t => (t <= -2 ? "distrustful" : t === -1 ? "wary" : t === 0 ? "neutral" : t === 1 ? "warming" : "trusting");
export const moodLabel = m => (m <= -2 ? "upset" : m === -1 ? "tense" : m === 0 ? "steady" : m === 1 ? "good" : "upbeat");
// Narrator/classifier view of the NUCs. Secrets are withheld in phase 1 (no in-play reveal yet).
export function nucContext(state) {
  return (state.nuc_sheets || []).map(n => { const r = state.nuc_state?.[n.id] || {};
    return { id: n.id, name: n.name, role: n.role, disposition: n.disposition, goals: n.goals, knows: n.knows, doesnt_know: n.doesnt_know,
      private_motive: n.hidden_goal ? n.hidden_goal + " (act consistently with it; NEVER state it)" : null,
      attitude_toward_trainee: `${trustLabel(r.trust ?? 0)}, mood ${moodLabel(r.mood ?? 0)}` }; });
}
// Text that must never appear in trainee-visible output during play.
export function nucSecretsText(state) { return (state.nuc_sheets || []).flatMap(n => [n.hidden_goal, ...n.secrets.map(s => s.fact)]).filter(x => x && x.length >= 12); }

// Debrief (shown only after .end, decision 1).
const sgn = x => (x > 0 ? "+" + x : String(x));
export function relationshipTable(state) {
  const sheets = state.nuc_sheets || []; if (!sheets.length) return "";
  const esc = s => String(s || "").replace(/\|/g, "/");
  const rows = sheets.map(n => { const r = state.nuc_state?.[n.id] || { trust: 0, mood: 0, start_trust: 0, start_mood: 0, history: [] };
    const moved = r.history.filter(h => h.d_trust).map(h => `T${h.turn} ${sgn(h.d_trust)} (${esc(h.why)})`).slice(-4).join("; ") || "no change";
    return `| ${esc(n.name)} | ${esc(n.role)} | ${sgn(r.start_trust)} → **${sgn(r.trust)}** (${trustLabel(r.trust)}) | ${sgn(r.start_mood)} → ${sgn(r.mood)} (${moodLabel(r.mood)}) | ${moved} |`; });
  const hidden = sheets.filter(n => n.hidden_goal || n.secrets.length).map(n => `- **${esc(n.name)}**: ${[n.hidden_goal && "wanted: " + n.hidden_goal, ...n.secrets.map(s => "secret: " + s.fact)].filter(Boolean).join("; ")}`);
  return `## Relationships\nHow the people in this scenario felt about you, from the start of the scenario to the end. Trust and mood run from −3 to +3. In code, trust and mood moved the difficulty of actions aimed at each person by at most ±2 (shown per roll in the roll audit).\n\n| Person | Role | Trust | Mood | What moved trust |\n|---|---|---|---|---|\n${rows.join("\n")}${hidden.length ? `\n\n**What they weren't telling you:**\n${hidden.join("\n")}` : ""}`;
}
