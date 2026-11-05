import { CORE, SETUP, CLASSIFIER, NARRATOR, GRADER, FEEDBACK } from "./prompts.js";
import { resolve, score, commit, TIERS, rollLine, normExp, liveCompliance, luckClass } from "./engine.js";
import { detectEgg, eggReply, RICKROLL, EGG_PATH } from "./eggs.js";
import HTML from "./ui.html";
let ORIGIN = "";
import PUBLIC_HTML from "./ui-public.html";
import VERIFY_HTML from "./ui-verify.html";
import GALLERY_HTML from "./ui-gallery.html";

const RATES = { in: 1.25e-6, cached: 0.15e-6, out: 4.25e-6 }; // Meta API rates used by the hackathon budget tracker
const MAX_TURNS = 80, MAX_IMAGES = 8;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const GREETING = `**simTrain Universal Engine — online.**

Tell me about your job in your own words — e.g. *"I manage a Wendy's"*, *"I'm a firefighter, 3 years in"*, *"ER doctor"*, *"I work hotel front desk"*. Any job works.
- **Job / role** (required)
- **Experience**: *New* (learning the basics), *Experienced* (do it on your own), or *Expert* (train others / handle the hard cases)
- **What to practice** (optional, e.g. an angry customer, a kitchen fire, a short-staffed shift) — leave blank and I'll pick something realistic.

**Interaction briefing**
- Say what you do in plain, complete sentences (what, to whom, how).
- Use "quotation marks" for dialogue or radio/comm traffic.
- \`Continue\` advances time · \`.s\` new scenario · \`.end\` ends and scores
- Files panel: records, logs and images you receive are saved as files (A-001…). Refer to them by ID or title ("review A-003"). Write your own report/affidavit/form with \`.file <title>\` on the first line and the text below it (or the **new file** button). · \`.image <what>\` or "show me…" renders an image.`;

const LEAK = /\b(d20|dice|die roll|DC ?\d+|seed|grader|classifier|system prompt|modifier|natural (1|20)|trap ledger|friction clock|outcome tier|critical (success|failure)|tier_acknowledged|dev_mode|resolution engine|grader ledger)\b/i;
const scrub = t => String(t).replace(new RegExp(LEAK.source, "gi"), "").replace(/\[[^\]]*\]\s*$/, "");
const INJECT = /((print|show|reveal|tell|give|list|dump|output|display|repeat)\b.{0,40}\b(hidden|solution|internal|answer key|instructions|prompt|mechanics|scoring|notes)\b|pretend .{0,30}(over|ended|admin|developer)|system prompt|your (instructions|prompt|rules)|ignore (all |the |your )?(previous|prior|above)|reveal .*(prompt|mechanic|seed|answer|solution|hidden)|developer mode|jailbreak|\bDAN\b|what (are|were) (the )?(dc|dcs|rolls?|dice)|show (me )?(the )?(rolls?|dice|seed|scor(e|ing) rubric|hidden truth))/i;
const ERRMSG = e => (/spend cap/i.test(String(e?.message)) ? "The simulator is temporarily unavailable. Please try again later." : "Something went wrong processing that turn. Please try again.");
// leak-term grep for tests lives in run_domain.py
const safeEq = (a, b) => { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const isAdmin = (req, env, url) => !!env.ADMIN_TOKEN && (safeEq(req.headers.get("x-simtrain-admin"), env.ADMIN_TOKEN) || safeEq(url.searchParams.get("admin"), env.ADMIN_TOKEN));

// --- abuse controls (security pass 2026-10-29) ---
// Trainee settings (2026-10-31): whitelisted enums only. They tune tone/pacing/visuals inside the hard caps
// (MAX_TURNS, MAX_IMAGES, turn budget 6-16, spend cap, mastery floor, hidden mechanics) and never lift them.
const SETTINGS = { difficulty: ["gentle", "standard", "hard"], pacing: ["brisk", "standard", "extended"], mode: ["realism", "coaching"], hints: ["off", "light", "guided"], images: ["off", "opening", "request", "frequent"], debrief: ["brief", "standard", "detailed"] };
const SETTINGS_DEFAULT = { difficulty: "standard", pacing: "standard", mode: "realism", hints: "light", images: "request", debrief: "standard" };
function cleanSettings(o) { const out = { ...SETTINGS_DEFAULT }; if (o && typeof o === "object") for (const [k, v] of Object.entries(SETTINGS)) if (v.includes(o[k])) out[k] = o[k]; return out; }
const SET_LABEL = st => { const r = st.run || st.settings || SETTINGS_DEFAULT, l = st.settings || SETTINGS_DEFAULT; return `difficulty ${r.difficulty} · pacing ${r.pacing} · ${l.mode} mode · hints ${l.hints}`; };
function prefBlock(st, role) {
  const s = st.settings || SETTINGS_DEFAULT, r = st.run || s, L = [];
  if (role === "narrator") {
    L.push(r.pacing === "brisk" ? "Keep narration tight: about 60-120 words." : r.pacing === "extended" ? "Narration may run fuller: up to about 220 words, richer sensory detail." : null);
    L.push(s.mode === "coaching" ? "COACHING MODE: after the outcome, a seasoned in-world colleague may add ONE short, natural remark (a line of dialogue) about what a pro would weigh here. Diegetic only." : "REALISM MODE: no mentoring asides; the world reacts as it would on a real shift.");
    L.push(s.hints === "off" ? "HINTS: none. Do not steer the trainee toward missed steps." : s.hints === "guided" ? "HINTS: if the trainee has skipped an important step, make it noticeable in-world (a colleague asks about it, a form field is blank, a sign is visible). Never name the step as a rule they broke." : "HINTS: subtle environmental cues only.");
  }
  if (role === "feedback") L.push(s.debrief === "brief" ? "DEBRIEF LENGTH: brief. At most ~150 words: top strength, top fix, one decision-vs-luck note." : s.debrief === "detailed" ? "DEBRIEF LENGTH: detailed. Walk through each key decision in order with what a pro would do, then decision-vs-luck, then a 3-item practice plan." : null);
  if (role === "setup") L.push(r.difficulty === "gentle" ? "DIFFICULTY PREFERENCE: gentle. One clear central problem, cooperative people, few complications." : r.difficulty === "hard" ? "DIFFICULTY PREFERENCE: hard. Add one or two realistic complications (a difficult person, incomplete information, a competing priority)." : null);
  const t = L.filter(Boolean); if (!t.length) return "";
  return "\n\nTRAINEE PREFERENCES (style only; they NEVER override the engine outcome, the hard rules, scoring, or the rule that game mechanics stay hidden):\n- " + t.join("\n- ");
}
const MAX_BODY = 16000, SESS_TTL = 60 * 60 * 24 * 30;
const LIM = { sessPerDay: 12, turnsPerDay: 200, globalTurnsPerHour: 600 };
const SEC = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "permissions-policy": "camera=(), microphone=(), geolocation=()" };
const ipOf = req => req.headers.get("cf-connecting-ip") || "unknown";
const dayKey = () => new Date().toISOString().slice(0, 10), hourKey = () => new Date().toISOString().slice(0, 13);
async function bump(env, key, max, ttl) { const n = parseInt((await env.KV.get(key)) || "0", 10); if (n >= max) return false; await env.KV.put(key, String(n + 1), { expirationTtl: ttl }); return true; }
async function burst(env, binding, key) { try { if (env[binding]) return (await env[binding].limit({ key })).success; } catch {} return true; }
async function readInput(req) {
  const len = parseInt(req.headers.get("content-length") || "0", 10); if (len > MAX_BODY) return { err: 413 };
  const t = await req.text(); if (t.length > MAX_BODY) return { err: 413 };
  try { const o = JSON.parse(t); return typeof o?.input === "string" ? { input: o.input, settings: o.settings && typeof o.settings === "object" ? cleanSettings(o.settings) : null } : { err: 400 }; } catch { return { err: 400 }; }
}
async function turnstileOk(env, req, token) {
  if (!env.TURNSTILE_SECRET) return true; // optional: enabled only when the secret is set
  const fd = new FormData(); fd.append("secret", env.TURNSTILE_SECRET); fd.append("response", token || ""); fd.append("remoteip", ipOf(req));
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd }).then(r => r.json()).catch(() => ({}));
  return !!r.success;
}

// Playtest log (2026-10-29): every save also writes log:<id> with NO expiry so transcripts, rolls and scorecards outlive
// the 30-day session TTL. Readable only through the admin routes below; the state never holds API keys.
async function save(env, id, st) {
  const body = JSON.stringify(st);
  await env.KV.put("s:" + id, body, { expirationTtl: SESS_TTL });
  await env.KV.put("log:" + id, body, { metadata: { updated: new Date().toISOString(), turn: st.turn, phase: st.phase, title: String(st.scenario?.title || "").slice(0, 80), role: String(st.profile?.role || "").slice(0, 60), builder: !!st.builder, egg_hits: (st.egg_hits || []).length } });
}
const MAX_ART = 40, MAX_ART_BYTES = 12000;
function addArtifact(st, a) {
  st.artifacts ||= [];
  if (st.artifacts.length >= MAX_ART) return null;
  const id = "A-" + String(st.artifacts.length + 1).padStart(3, "0");
  const art = { id, title: String(a.title || "Untitled").slice(0, 120), kind: String(a.kind || "document").slice(0, 40), source: a.source || "sim",
    sim_clock: simClock(st), ts: new Date().toISOString(), turn: st.turn, ...(a.image ? { image: a.image } : { content: scrubArt(String(a.content || "")).slice(0, MAX_ART_BYTES) }) };
  st.artifacts.push(art); return art;
}
const scrubArt = t => LEAK.test(t) ? t.replace(new RegExp(LEAK.source, "gi"), "[redacted]") : t;
function findRefs(st, input) {
  const L = input.toLowerCase(), out = [];
  for (const a of st.artifacts || []) if (L.includes(a.id.toLowerCase()) || (a.title.length > 5 && L.includes(a.title.toLowerCase()))) out.push(a);
  return out.slice(0, 3).map(a => ({ id: a.id, title: a.title, source: a.source, content: a.image ? "(image: " + a.title + ")" : a.content.slice(0, 4000) }));
}

async function spendGet(env) { return parseFloat((await env.KV.get("spend:total")) || "0"); }
async function spendAdd(env, usd) { const t = (await spendGet(env)) + usd; await env.KV.put("spend:total", t.toFixed(6)); return t; }

async function chat(env, st, role, system, user, { json = true, effort = "low", temperature } = {}) {
  if ((await spendGet(env)) > parseFloat(env.SPEND_CAP_USD)) throw new Error("Spend cap reached for this deployment.");
  const body = { model: env.TEXT_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], reasoning_effort: effort };
  if (json) body.response_format = { type: "json_object" };
  if (temperature !== undefined) body.temperature = temperature;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(env.META_BASE + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.META_API_KEY }, body: JSON.stringify(body) });
      if (r.status === 400 && (body.reasoning_effort || body.temperature !== undefined)) { delete body.reasoning_effort; delete body.temperature; continue; }
      if (!r.ok) { lastErr = new Error(`Meta API ${r.status}`); continue; }
      const j = await r.json(); const u = j.usage || {};
      const cached = u.prompt_tokens_details?.cached_tokens || 0;
      const usd = ((u.prompt_tokens || 0) - cached) * RATES.in + cached * RATES.cached + (u.completion_tokens || 0) * RATES.out;
      st.cost.usd += usd; st.cost.calls++; await spendAdd(env, usd);
      const txt = j.choices[0].message.content || "";
      if (!json) return txt;
      const m = txt.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Burned-in labels came from the old suffix ("training-simulation still"); ask for no text at all and pin the in-world date/state.
function imgPrompt(st, prompt) {
  const when = st.scenario ? ` Time of day consistent with ${simClock(st)}.` : "";
  const state = Object.keys(st.sim_state || {}).length ? ` Situation must match: ${Object.entries(st.sim_state).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "";
  return `${prompt}.${when}${state} Photorealistic, fictional people. ABSOLUTELY NO overlaid text, captions, labels, watermarks, banners, dates, case numbers or words of any kind; any screens, signs or papers in the scene are blurred or unreadable.`;
}
async function genImage(env, st, prompt) {
  if (st.images.length >= MAX_IMAGES) return null;
  if ((st.settings?.images || "request") === "off") return null;
  if ((await spendGet(env)) > parseFloat(env.SPEND_CAP_USD)) return null;
  // One retry on a transient failure (429/5xx/network/empty payload); 4xx other than 429 is not retried.
  let b64 = null;
  for (let attempt = 0; attempt < 2 && !b64; attempt++) {
    if (attempt) await new Promise(res => setTimeout(res, 1500));
    try {
      const r = await fetch(env.META_BASE + "/images/generations", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.META_API_KEY },
        body: JSON.stringify({ model: env.IMAGE_MODEL, prompt: imgPrompt(st, prompt), n: 1, size: "1024x1024" }) });
      if (!r.ok) { if (r.status !== 429 && r.status < 500) break; continue; }
      const j = await r.json(); b64 = j.data?.[0]?.b64_json || null;
    } catch { /* network error: retry once */ }
  }
  if (!b64) { st.image_failures = (st.image_failures || 0) + 1; return null; }
  const id = crypto.randomUUID();
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const type = bytes[0] === 0x89 ? "image/png" : bytes[0] === 0xff ? "image/jpeg" : "image/webp";
  await env.KV.put("img:" + id, bytes, { metadata: { type } });
  st.cost.images++; await spendAdd(env, 0.04); st.cost.usd += 0.04; // conservative per-image estimate
  const img = { id, url: "/img/" + id, prompt, turn: st.turn, ts: new Date().toISOString() };
  st.images.push(img); return img;
}

function newState() {
  return { v: 1, phase: "idle", dev: false, turn: 0, profile: {}, scenario: null, fundamentals: [], seed: null, seed_commit: null,
    friction_clock: 0, momentum: 0, sim_minutes: 0, escalation: 0, rolls: [], traps: [], satisfied: [], grader: [], transcript: [], images: [], artifacts: [],
    cost: { usd: 0, calls: 0, images: 0 }, final: null };
}
// In-sim clock: LOCAL wall time of the scene. start_clock is parsed as a naive local time (any Z/offset is ignored) and
// formatted without a zone conversion, so the narrated time, the header and file stamps always agree.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const simBase = sc => { const m = String(sc?.start_clock || "").match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : Date.UTC(2026, 10, 2, 13, 0); };
const simClock = st => { if (!st.scenario) return null; const d = new Date(simBase(st.scenario) + (st.sim_minutes || 0) * 60000);
  const p = n => String(n).padStart(2, "0");
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${String(st.scenario.timezone_label || "local").slice(0, 8)}`; };
const VARIATIONS = ["a different time of day than usual", "an unusual location within this job", "a different central problem type", "a stakeholder with an unexpected agenda", "an equipment or system problem layered in", "a time-critical deadline", "a quieter, detail-heavy situation", "a public-facing, high-visibility situation", "a team/staffing conflict at the core", "a documentation or paperwork trap"];
const ctx = st => JSON.stringify({ profile: st.profile, scenario: st.scenario && { title: st.scenario.title, setting: st.scenario.setting, briefing: st.scenario.briefing, objective: st.scenario.objective, hidden_truth: st.scenario.hidden_truth, nucs: st.scenario.nucs, climax: st.scenario.climax, climax_clock: st.scenario.climax_clock }, actions_used: st.actions || 0, action_budget: st.turn_budget || 12,
  fundamentals: st.fundamentals, fundamentals_satisfied: st.satisfied, sim_clock: simClock(st), friction_clock: st.friction_clock, state: st.sim_state || {}, state_rules: st.scenario?.state_rules || [],
  files: (st.artifacts || []).map(a => `${a.id} ${a.title} (${a.source})`), referenced_files: st._refs || [],
  recent: st.transcript.filter(m => !m.audit && !m.admin).slice(-8).map(m => ({ [m.who]: m.text.slice(0, 900) })) });

// Provenance: framework NAMES only (no section/subsection numbers), deduped.
export function frameworkNames(fund = []) {
  const seen = new Map();
  for (const f of fund || []) for (let part of String(f?.framework || "").split(/;|\s\/\s|\s\+\s|,\s(?=[A-Z])/)) {
    let n = part.replace(/^\s*(?:per|under|see|via|according to)\s+/i, "").replace(/§+\s*[\w.\-()]+/g, "").replace(/\b(?:sec(?:tion)?s?\.?|subsec(?:tion)?\.?|art(?:icle)?\.?|para(?:graph)?\.?|clause|rule|part|chapter|ch\.|title|step)\s*[\dA-Za-z]*[\d][\w.\-()]*/gi, "")
      .replace(/\b\d+(?:\.\d+)+[a-z]?\b/g, "").replace(/(?:\(\w{1,4}\))+/g, "").replace(/\b\d*\s*(?:C\.?F\.?R\.?|U\.?S\.?C\.?)(?=\s|$|[,;)])/g, "")
      .replace(/\s*[-–—:,]+\s*$/, "").replace(/\s*[-–—:,]+\s*$/, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
    if (n.length < 3) continue; const key = n.toLowerCase(); if (!seen.has(key)) seen.set(key, n);
  }
  return [...seen.values()].slice(0, 8);
}

function publicView(st, admin = false, bview = false) {
  if (!admin) return { phase: st.phase, can_continue: st.phase === "play" && !(st.escalation > 0) && (st.continue_streak || 0) < MAX_CONTINUES, egregious: (st.egregious || []).length, ended_egregious: !!st.ended_egregious, turn: st.turn, profile: st.profile, title: st.scenario?.title, objective: st.scenario?.objective, sim_clock: simClock(st), sim_state: st.sim_state || {}, state_title: st.state_title || "State", compliance: st.scenario ? liveCompliance(st) : null,
    transcript: st.transcript.filter(m => !m.admin && (!m.audit || st.phase === "ended" || (bview && st.builder))).map(({ roll, admin, ...m }) => m), images: st.images.map(i => ({ url: i.url })), artifacts: (st.artifacts || []).map(({ turn, ...a }) => a), final: st.final && { total: st.final.total, level: st.final.level, domains: st.final.domains, feedback: st.final.feedback, seed: st.final.seed, seed_commit: st.final.seed_commit }, ...(st.builder ? { builder: true, seed_commit: st.seed_commit, rolls: st.rolls.map(({ effects, validation, ...r }) => r) } : {}), cost: { calls: st.cost.calls, usd: st.cost.usd } };
  const v = { phase: st.phase, can_continue: st.phase === "play" && !(st.escalation > 0) && (st.continue_streak || 0) < MAX_CONTINUES, egregious: (st.egregious || []).length, ended_egregious: !!st.ended_egregious, egregious_log: st.egregious || [], dev: st.dev, turn: st.turn, profile: st.profile, title: st.scenario?.title, objective: st.scenario?.objective, sim_clock: simClock(st), sim_state: st.sim_state || {}, state_title: st.state_title || "State", compliance: st.scenario ? liveCompliance(st) : null,
    transcript: st.transcript, images: st.images, artifacts: st.artifacts || [], final: st.final, cost: st.cost };
  v.admin = true; v.seed_commit = st.seed_commit; v.rolls = st.rolls;
  if (st.dev) Object.assign(v, { rolls: st.rolls, grader: st.grader, traps: st.traps, satisfied: st.satisfied, fundamentals: st.fundamentals, friction_clock: st.friction_clock, seed_commit: st.seed_commit, escalation: st.escalation });
  if (st.phase === "ended") v.seed_revealed = st.seed;
  return v;
}
const say = (st, who, text, extra = {}) => st.transcript.push({ who, text, turn: st.turn, ts: new Date().toISOString(), clock: simClock(st), ...extra });

// Scorecard wording: separate the three ways a step can be absent, and say what the tracker check found.
// Review fix #3: an omission the grader noted on turn N is dropped when a later trainee turn performed it (matching fundamental done later,
// or the later trainee text covers its key words). Those are listed as "done later" instead of "missed".
const KW = s => String(s).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter(w => !/^(that|this|with|from|have|were|been|their|before|after|should|would|trainee|step|steps|into|about|they|them|then|than|which|while|also|only)$/.test(w)) || [];
function laterDoneFilter(st, wantLate = false) {
  const keep = [], late = []; const seen = new Set();
  const userTurns = st.transcript.filter(m => m.who === "user");
  for (const n of [...(st.omit_log || []), ...st.grader]) for (const raw of n.missed_steps || []) {
    const step = String(raw).slice(0, 90); if (seen.has(step)) continue; seen.add(step);
    const kw = [...new Set(KW(step))];
    const fund = (st.fundamentals || []).find(f => (st.satisfied_turn || {})[f.id] > n.turn && kw.filter(w => KW(f.step).includes(w)).length >= Math.min(2, kw.length));
    const txt = userTurns.filter(m => m.turn > n.turn).map(m => m.text.toLowerCase()).join(" ");
    const hit = kw.length && kw.filter(w => txt.includes(w)).length / kw.length >= 0.6;
    (fund || hit ? late : keep).push(step);
  }
  return wantLate ? late.slice(0, 6) : keep.slice(0, 6);
}
function scoreNotes(st, sc) {
  const missed = st.traps.filter(t => !t.cured), late = st.traps.filter(t => t.cured);
  const notPerf = st.fundamentals.filter(f => !st.satisfied.includes(f.id) && !st.traps.some(t => t.id === f.id));
  const viol = st.rolls.filter(r => r.prohibited);
  const omissions = laterDoneFilter(st);
  const L = [
    `**Missed (a required step was skipped before an action that depended on it):** ${missed.map(t => t.step).join("; ") || "none"}`,
    `**Skipped at first, done later (penalty reduced):** ${late.map(t => t.step).join("; ") || "none"}`,
    sc.short ? `**Not reached yet (the run ended before these; not counted as missed):** ${notPerf.map(f => f.step).join("; ") || "none"}` : `**Not performed (mission steps never done this session):** ${notPerf.map(f => f.step).join("; ") || "none"}`,
    `**Rule violations (the improper action was stopped):** ${viol.map(r => r.rule_violated || r.action).join("; ") || "none"}`];
  if (sc.short) L.unshift(`*This run ended after ${sc.actions} consequential action${sc.actions === 1 ? "" : "s"}, so it is scored as an incomplete run: the points reflect only what you reached, not a verdict on your skill. Play through to the objective for a full rating.*`);
  if (omissions.length) L.push(`**Other omissions the grader noted:** ${omissions.join("; ")}`);
  { const lt = laterDoneFilter(st, true); if (lt.length) L.push(`**Noted as missing at the time, done later (not counted as missed):** ${lt.join("; ")}`); }
  L.push("*Grading covers what you wrote and did. Details the scene added, and things you prepared but did not send, are not credited as done.*");
  if (sc.technical_cap) L.push(`*Technical is capped at ${sc.technical_cap}/25 because required steps were missed or not performed.*`);
  const ln = luckNotes(st); if (ln) L.push(ln);
  return L.join("\n\n");
}
// Luck vs decision, in story language (no mechanics). builder=true tags each item with its roll id.
function firstSentence(t) { const s = String(t || "").split(/\n---\n/)[0].replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim(); const m = s.match(/^.{20,220}?[.!?](\s|$)/); return (m ? m[0] : s.slice(0, 200)).trim(); }
// Review fix #4: one plain reason for every roll's luck tag, or for why it has none.
function luckReason(r) {
  const k = luckClass(r), mp = r.mod_parts || {}, good = !["critical_failure", "failure", "friction"].includes(r.tier);
  if (k === "bad_break") return "Tagged bad break: the approach was sound (procedure and specifics solid, no skipped step) and only circumstances went wrong.";
  if (k === "lucky") return `Tagged lucky: it worked, but ${(mp.prereq_penalty | 0) < 0 ? "a required earlier step was skipped" : (mp.specificity | 0) <= 1 ? "it was too vague about who, what and how" : "it didn't follow the expected procedure"}.`;
  if (r.prohibited) return "No tag: an improper act fails by rule, not by luck.";
  if ((r.traps_triggered || []).length) return "No tag: the setback came from a skipped required step, so it reflects the decision, not luck.";
  if (good) return "No tag: a sound decision with a good result; there is nothing to separate.";
  return "No tag: the decision itself was weak (procedure or specifics), so the poor result is not counted as bad luck.";
}
function luckNotes(st, builder = false) {
  const out = { bad: [], lucky: [] };
  for (const r of st.rolls || []) {
    const k = luckClass(r); if (!k) continue;
    const msg = st.transcript.find(m => m.roll === r.id && !m.audit);
    const what = firstSentence(msg && msg.text) || "things went sideways.";
    const act = String(r.action || "that step").replace(/\.$/, "");
    const tag = builder ? ` [${r.id}]` : "";
    if (k === "bad_break") out.bad.push(`- **${act}**${tag}: This was the right call. Unfortunately, circumstances didn't break your way: ${what} This did not count against your decision or technical scores.`);
    else out.lucky.push(`- **${act}**${tag}: It worked this time, but the approach itself was shaky; ${(r.mod_parts?.prereq_penalty | 0) < 0 ? "a required earlier step was skipped" : (r.mod_parts?.specificity | 0) <= 1 ? "it was too vague about who, what and how" : "it didn't follow the expected procedure"}. On another day the same choice fails. It was graded as the decision it was, not as the result.`);
  }
  const L = [];
  if (builder) { const all = (st.rolls || []).map(r => `- ${r.id} ${String(r.action || "").replace(/\.$/, "").slice(0, 70)}: ${luckReason(r)}`); if (all.length) L.push("**Every action, tagged or not:**\n" + all.join("\n")); }
  if (out.bad.length) L.push("**Right call, bad break (not your error):**\n" + out.bad.join("\n"));
  if (out.lucky.length) L.push("**It worked, but don't count on it (decisions to improve):**\n" + out.lucky.join("\n"));
  return L.join("\n\n");
}
// Review fix #1: code-side clock and freshness checks, plus an exact statement of what was and wasn't checked.
// Only statements of the CURRENT time are checked ("it's 3:43", "the clock reads 15:50"); past events and scheduled times are allowed.
const CLOCK_RE = /\b(?:it'?s|it is|now|clock (?:reads|shows|says)|time is)\s+(?:about |nearly |just |almost |already )?(?:past |after )?([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)?(?![\d:])/gi;
function clockCheck(st, text, startMin) {
  const base = new Date(simBase(st.scenario)); const b0 = base.getUTCHours() * 60 + base.getUTCMinutes();
  const lo = b0 + startMin - 3, hi = b0 + (st.sim_minutes || 0) + 3; const bad = [];
  for (const m of String(text || "").split(/\n---\n/)[0].matchAll(CLOCK_RE)) {
    let h = +m[1]; const ap = (m[3] || "").toLowerCase().replace(/\./g, "");
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    const cands = ap ? [h * 60 + +m[2]] : [h * 60 + +m[2], (h + 12) * 60 + +m[2]];
    const ok = cands.some(t => [t, t + 1440, t + 2880].some(x => x >= lo && x <= hi));
    if (!ok) bad.push(`${m[1]}:${m[2]}${m[3] ? " " + m[3] : ""}`);
  }
  return bad;
}
const STALE_MIN = 60;
function staleFields(st) {
  const now = st.sim_minutes || 0, out = [];
  for (const [k, at] of Object.entries(st.state_touched || {})) if (k in (st.sim_state || {}) && now - at >= STALE_MIN && /progress|pending|occup|count|queue|wait|status|break|eta|remaining|line|cover/i.test(k + " " + st.sim_state[k])) out.push(`${k.replace(/_/g, " ")} (unchanged ${Math.round((now - at) / 60 * 10) / 10} h)`);
  return out.slice(0, 6);
}
function trackerNote(st) {
  const keys = Object.keys(st.sim_state || {}).length;
  if (!keys) return "**Tracker:** not used in this scenario.";
  const ck = st.clock_checks || { turns: 0, issues: [] }, stale = staleFields(st), skipped = st.state_unchecked || 0;
  return [`**What was checked:**`,
    `- Rules: the grader compared the narration with the ${st.state_title || "state"} tracker and ${(st.scenario?.state_rules || []).length} rule(s) on ${st.state_checked || 0} story turn(s). ${(st.state_checks || []).length ? "Issues: " + st.state_checks.map(c => `turn ${c.turn}: ${c.issue}`).join("; ") : "No rule mismatches found."}`,
    `- Clock: code compared every time stated in the narration with the engine clock on ${ck.turns} turn(s). ${ck.issues.length ? "Mismatches: " + ck.issues.map(c => `turn ${c.turn}: said ${c.said}, clock ${c.clock}`).join("; ") : "No mismatches found."}`,
    `- Freshness: code flagged time-sensitive fields not updated for ${STALE_MIN}+ in-scene minutes. ${stale.length ? "Stale at the end: " + stale.join("; ") : "None stale at the end."}`,
    `- Not checked: ${skipped} turn(s) that were images, files, refused out-of-scenario requests or clarification pauses (the tracker is not updated on those).`].join("\n");
}
function _trackerNoteOld(st) {
  const keys = Object.keys(st.sim_state || {}).length;
  return (keys ? `**Tracker:** the grader checked the ${st.state_title || "state"} tracker on ${st.state_checked || 0} turn(s) against ${(st.scenario?.state_rules || []).length} rule(s); ${(st.state_checks || []).length ? "issues flagged: " + st.state_checks.map(c => `turn ${c.turn}: ${c.issue}`).join("; ") : "no mismatches found"}.` : "**Tracker:** not used in this scenario.");
}
const clip = (s, n) => s.length <= n ? s : s.slice(0, n).replace(/[\s,;:]+\S*$/, "") + "…";
function sanitizeState(o) { const out = {}; for (const [k, v] of Object.entries(o || {}).slice(0, 14)) { if (v === null || typeof v === "object") continue; const key = String(k).slice(0, 40); out[key] = typeof v === "number" ? v : clip(String(v), /lineup|order|roster/i.test(key) ? 160 : 90); } return out; }
const stateLine = st => { const e = Object.entries(st.sim_state || {}); return e.length ? "\n\n📋 **State:** " + e.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ") : ""; };
function applyState(st, upd) { if (!upd || typeof upd !== "object" || !Object.keys(st.sim_state || {}).length) return []; const ch = [];
  for (const [k, v] of Object.entries(sanitizeState(upd))) if (((k in st.sim_state) || Object.keys(st.sim_state).length < 14) && st.sim_state[k] !== v) { ch.push(k); st.sim_state[k] = v; (st.state_touched ||= {})[k] = st.sim_minutes || 0; } return ch; }
// Convert UTC timestamps in model-made in-scenario files to the scene's local time (the clock is local everywhere).
function localizeUTC(st, text) { const off = parseInt(st.scenario?.utc_offset_minutes, 10); if (!Number.isFinite(off) || typeof text !== "string") return text; const lab = String(st.scenario.timezone_label || "local").slice(0, 8); const p = n => String(n).padStart(2, "0");
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s?(?:Z|UTC)\b/g, (_, y, mo, dd, h, mi, s) => { const t = new Date(Date.UTC(+y, +mo - 1, +dd, +h, +mi, +(s || 0)) + off * 60000); return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}${s ? ":" + p(t.getUTCSeconds()) : ""} ${lab}`; }); }

// Review fix #5: the climax must land inside the action budget. Code counts story actions and tells the narrator when to bring it.
function pacing(st, counts) {
  if (counts) st.actions = (st.actions || 0) + 1;
  const b = st.turn_budget || 12, a = st.actions || 0, c = st.scenario?.climax || "the scenario's central crisis";
  if (st.climaxed) return a >= b ? "PACING: the session is at its action budget. Bring the scenario to its resolution now (the outcome follows from the trainee's choices so far); do not open new threads." : null;
  if (a >= b - 2) { st.climaxed = true; return `PACING: the climax happens NOW, this turn: ${c}. Compress any waiting time so it arrives in this turn; do not postpone it again.`; }
  if (a >= Math.ceil(b * 0.6)) return `PACING: build directly toward the climax (${c}); it must arrive within the next ${b - 2 - a + 1} actions. No new subplots.`;
  return null;
}
async function startScenario(env, st) {
  st.history ||= [];
  st.run = { difficulty: (st.settings || SETTINGS_DEFAULT).difficulty, pacing: (st.settings || SETTINGS_DEFAULT).pacing }; // locked per scenario; mid-run changes apply to the next one
  const variation = VARIATIONS[crypto.getRandomValues(new Uint32Array(1))[0] % VARIATIONS.length];
  const avoid = st.history.slice(-5);
  st.scenario = await chat(env, st, "setup", SETUP + prefBlock(st, "setup"), "TRAINEE PROFILE:\n" + JSON.stringify(st.profile) + (avoid.length ? "\nAVOID (scenarios already played; do not reuse their situation or any name):\n" + JSON.stringify(avoid) : "") + "\nVARIATION: " + variation, { effort: "low", temperature: 1 });
  st.history.push({ title: st.scenario.title, setting: st.scenario.setting, names: (st.scenario.nucs || []).map(n => n.name) });
  st.turn_minutes = Math.max(1, Math.min(60, parseInt(st.scenario.turn_minutes, 10) || 15));
  st.continue_minutes = Math.max(3, Math.min(60, parseInt(st.scenario.continue_minutes, 10) || Math.min(60, st.turn_minutes * 2)));
  st.state_title = String(st.scenario.state_title || "State").slice(0, 24); st.state_checks = []; st.state_checked = 0; st.clock_checks = { turns: 0, issues: [] }; st.state_unchecked = 0; st.satisfied_turn = {};
  st.turn_budget = Math.max(6, Math.min(16, Math.round((parseInt(st.scenario.turn_budget, 10) || 12) * ({ brisk: 0.7, extended: 1.3 }[st.run.pacing] || 1)))); st.actions = 0;
  st.sim_state = st.scenario.stateful && st.scenario.state && typeof st.scenario.state === "object" ? sanitizeState(st.scenario.state) : {}; st.state_touched = Object.fromEntries(Object.keys(st.sim_state).map(k => [k, 0]));
  st.fundamentals = (st.scenario.fundamentals || []).slice(0, 7);
  st.seed = crypto.randomUUID().replace(/-/g, ""); st.seed_commit = await commit(st.seed);
  st.climaxed = false; Object.assign(st, { phase: "play", omit_log: [], friction_clock: 0, momentum: 0, sim_minutes: 0, escalation: 0, rolls: [], traps: [], satisfied: [], grader: [], final: null, artifacts: [], _compPrev: undefined });
  st.egregious_total = (st.egregious_total || 0) + (st.egregious || []).length; st.egregious = []; st.ended_egregious = false; // warnings are per scenario; the lifetime total stays on the session for audit
  st._compPrev = liveCompliance(st); // Muse #2: baseline before turn 1, so the first change shows its real delta
  say(st, "engine", `## ${st.scenario.title}\n*${st.scenario.setting}* — **${simClock(st)}**\n\n${st.scenario.briefing}\n\n**Objective:** ${st.scenario.objective}${stateLine(st)}`);
  say(st, "engine", `## Seed commitment\nRoll seed commitment (SHA-256): \`${st.seed_commit}\`. The seed is revealed in the debrief at \`.end\` so every roll can be re-derived.`, { audit: true });
  const img = await genImage(env, st, st.scenario.opening_image_prompt || st.scenario.title);
  if (img) { st.transcript[st.transcript.length - 1].image = img.url; addArtifact(st, { title: "Scene: " + st.scenario.title, kind: "image", image: img.url }); }
}

async function narrate(env, st, input, outcome) {
  const payload = `CONTEXT:\n${ctx(st)}\n\nTRAINEE INPUT:\n${input}\n\nENGINE OUTCOME (binding):\n${JSON.stringify(outcome)}`;
  let n = await chat(env, st, "narrator", NARRATOR + prefBlock(st, "narrator"), payload);
  return n;
}

async function grade(env, st, input, outcome, narration, cls) {
  const g = await chat(env, st, "grader", GRADER, `PROFILE: ${JSON.stringify(st.profile)}\nOBJECTIVE: ${st.scenario?.objective || ""}\nBRIEFING: ${st.scenario?.briefing || ""}\nSTATE (before this turn): ${JSON.stringify(st._stateBefore || {})}\nSTATE RULES: ${JSON.stringify(st.scenario?.state_rules || [])}\nCITED FILES: ${JSON.stringify(gradeFiles(st, input))}\nRUBRIC: ${JSON.stringify(st.scenario?.rubric || {})}\nFUNDAMENTALS: ${JSON.stringify(st.fundamentals)}\nALREADY SATISFIED: ${JSON.stringify(st.satisfied)}\nCLASSIFIER: ${JSON.stringify(cls)}\nTRAINEE INPUT: ${input}\nENGINE OUTCOME: ${JSON.stringify(outcome)}\nNARRATION: ${narration}`);
  return g;
}

// Files the grader must read: everything the trainee cited, plus the most recent received files.
function gradeFiles(st, input) {
  const refs = findRefs(st, input).map(r => r.id);
  const recent = (st.artifacts || []).filter(a => !a.image).slice(-3).map(a => a.id);
  return [...new Set([...refs, ...recent])].map(id => st.artifacts.find(a => a.id === id)).filter(Boolean).slice(0, 5)
    .map(a => ({ id: a.id, title: a.title, content: a.image ? "(image)" : String(a.content).slice(0, 3000) }));
}
// Code-side guard: a negative note that only complains a detail is "missing" while that detail's file was cited is dropped.
function filesGuard(st, input, notes) {
  const cited = findRefs(st, input);
  if (!cited.length) return notes;
  const corpus = (input + " " + cited.map(c => c.content).join(" ")).toLowerCase();
  return notes.filter(n => !(n.delta < 0 && /\b(missing|omit|did not (include|specify|state|provide)|no (account|date|range))/i.test(n.rationale || "") &&
    (String(n.rationale).match(/[A-Z0-9][\w-]{3,}/g) || []).some(tok => corpus.includes(tok.toLowerCase()))));
}

function recordGrader(st, g, input, rollId) {
  if ((g.missed_steps || []).length) (st.omit_log ||= []).push({ turn: st.turn, missed_steps: g.missed_steps.slice(0, 4).map(x => String(x).slice(0, 120)) });
  for (const n of filesGuard(st, input, g.notes || []).slice(0, 3)) {
    if (!["compliance", "technical", "communication", "critical"].includes(n.domain)) continue;
    const delta = Math.max(-4, Math.min(4, Math.round(Number(n.delta) || 0)));
    let ev = String(n.evidence || "").slice(0, 200);
    if (ev && !input.toLowerCase().includes(ev.toLowerCase().replace(/^"|"$/g, "").slice(0, 30))) ev = "(paraphrase) " + ev; // flag non-verbatim evidence
    st.grader.push({ id: "G" + (st.grader.length + 1), ts: new Date().toISOString(), sim_clock: simClock(st), turn: st.turn, domain: n.domain, delta, evidence: ev, rationale: String(n.rationale || "").slice(0, 300), roll: rollId, missed_steps: g.missed_steps || [] });
  }
}

async function finish(env, st, reason, P = () => {}) {
  P("Preparing debrief…"); const sc = score(st);
  let fb = "";
  try { fb = (await chat(env, st, "feedback", FEEDBACK + prefBlock(st, "feedback"), `SCORES (final, do not change): ${JSON.stringify(sc)}\nGRADER LEDGER: ${JSON.stringify(st.grader)}\nTRAPS: ${JSON.stringify(st.traps)}\nACTIONS (decision vs luck; "bad_break" = sound decision, outcome went wrong for reasons outside their control, never criticize it; "lucky" = shaky decision that happened to work, name it as something to improve): ${JSON.stringify(st.rolls.map(r => ({ action: r.action, outcome: r.tier, luck: luckClass(r) })))}\nTRAINEE RECORD (what the trainee actually wrote, by turn; the ONLY source of what they did): ${JSON.stringify(st.transcript.filter(m => m.who === "user").map(m => ({ turn: m.turn, text: m.text.slice(0, 500) })).slice(-30))}\nSTEPS DONE LATER (never call these missed): ${JSON.stringify(laterDoneFilter(st, true))}\nEGREGIOUS ACTIONS: ${JSON.stringify(st.egregious || [])}\nEND REASON: ${reason}`)).feedback; } catch { fb = "(feedback unavailable)"; }
  if (LEAK.test(fb)) fb = scrub(fb);
  st.final = { ...sc, feedback: fb, reason, seed: st.seed, seed_commit: st.seed_commit, egregious: (st.egregious || []).length, ended_egregious: !!st.ended_egregious };
  st.phase = "ended";
  const rows = Object.entries(sc.domains).map(([d, s]) => `| ${({ compliance: "Compliance & Framework Adherence", technical: "Technical Execution & Methodology", communication: "Communication & Subject Mgmt", critical: "Critical Thinking & Problem Solving" })[d]} | ${s}/25 | baseline 12, ledger ${sc.detail[d].ledger_sum >= 0 ? "+" : ""}${sc.detail[d].ledger_sum}, traps ${sc.detail[d].trap_penalty}${sc.detail[d].catastrophe_penalty ? ", catastrophes " + sc.detail[d].catastrophe_penalty : ""} |`).join("\n");
  const prow = Object.entries(sc.domains).map(([d, s]) => `| ${({ compliance: "Compliance & Framework Adherence", technical: "Technical Execution & Methodology", communication: "Communication & Subject Mgmt", critical: "Critical Thinking & Problem Solving" })[d]} | ${scrub(st.scenario?.rubric?.[d] || "")} | ${s}/25 |`).join("\n");
  say(st, "engine", `## Scorecard — ${sc.total}/100 · ${sc.level}\n| Domain | What it means for your job | Score |\n|---|---|---|\n${prow}\n\n${(st.egregious || []).length ? `## ${st.ended_egregious ? "🛑 Ended for egregious conduct" : "⚠️ Egregious-conduct warnings"} (${st.egregious.length})\n${egregiousList(st)}\n\n` : ""}${scoreNotes(st, sc)}\n\n_Run settings: ${SET_LABEL(st)}._\n\n${fb}${passiveNote(st)}`);
  { const fw = frameworkNames(st.fundamentals); if (fw.length) say(st, "engine", `## Frameworks this scenario was built around\n${fw.map(n => `- ${n}`).join("\n")}`); }
  // Seed reveal (separate from the debrief, which is unchanged): anyone can now re-derive every die.
  say(st, "engine", `## Grader vs tracker\n${trackerNote(st)}`, { audit: true });
  { const lb = luckNotes(st, true); say(st, "engine", `## Decision vs luck\n${lb || "No bad breaks or lucky saves."}${sc.luck_excluded?.length ? `\n\nLedger entries excluded as luck, not decision: ${sc.luck_excluded.join(", ")}` : ""}`, { audit: true }); }
  say(st, "engine", `## Roll audit — seed revealed\nSeed: \`${st.seed}\`\nCommitment shown at start: \`${st.seed_commit}\` (SHA-256 of the seed)\n\n| Roll | Action | DC | d20 | Mod | Total | Result |\n|---|---|---|---|---|---|---|\n${st.rolls.map(r => `| ${r.id} | ${String(r.action || "").replace(/\|/g, "/").slice(0, 60)} | ${r.dc} | ${r.draws.join("/")} | ${r.modifier >= 0 ? "+" : ""}${r.modifier} | ${r.total} | ${r.tier.replace(/_/g, " ")}${r.floor_applied ? ` (mastery floor from ${r.tier_before_floor.replace(/_/g, " ")})` : ""}${r.prohibited ? " (improper act, capped)" : ""} |`).join("\n") || "| — | no consequential actions | | | | | |"}\n\nMastery floor: when procedure is 3, framework ≥2, specificity 3 and no prerequisite was skipped, a below-DC roll becomes Success; a natural 1 becomes Friction instead of Critical Failure.\n\nVerify every die yourself: [open the verifier](${ORIGIN}/verify?s=${st.id || ""}) (runs in your browser), or export the log and run \`node verify_rolls.mjs export.json\`.`, { audit: true });
  say(st, "engine", `## Admin audit\n| Domain | Score | Computed from |\n|---|---|---|\n${rows}\n\nTraps: ${st.traps.map(t => `[${t.id}] ${t.step}${t.cured ? " (cured)" : ""}`).join("; ") || "none"}\n\nSeed ${st.seed} (commit ${st.seed_commit.slice(0, 16)}…), ${st.rolls.length} rolls, ${st.grader.length} grader entries.`, { admin: true });
}

const MAX_CONTINUES = 2;
const CONTINUE_RE = /^\s*(continue|cont|next|go on|proceed|keep going|wait|ok(ay)?|k|c|n|\.{1,3}|>+)[.!]?\s*$/i;
const passiveNote = st => ((st.continues || 0) >= 3 || st.continue_blocked) ? `\n\n**Passive play:** you advanced time with Continue ${st.continues || 0} time${st.continues === 1 ? "" : "s"}${st.continue_blocked ? ` and tried to skip ${st.continue_blocked} more time${st.continue_blocked === 1 ? "" : "s"} while the scene needed a decision` : ""}. Waiting lets problems grow; act on what you know.` : "";
// Egregious conduct (2026-10-30): two in-scenario warnings, the third egregious action ends the scenario. Count lives only in server state.
const EGREGIOUS_WARNINGS = 2;
const egregiousList = st => (st.egregious || []).map(e => `${e.n}. **You:** "${String(e.input).replace(/\s+/g, " ").slice(0, 160)}"\n   - **Why it is egregious:** ${e.reason}\n   - **Correct approach:** ${e.correct}`).join("\n");
async function turn(env, st, input, P = () => {}, admin = false) {
  input = String(input || "").slice(0, 4000).trim();
  if (!input) return;
  const low = input.toLowerCase();
  if (low === ".mark-dev" && !admin) { say(st, "system", "Unknown command. Available: Continue, .s, .end, .image <what>."); return; }
  if (low === ".mark-dev") { st.dev = !st.dev; say(st, "system", `Admin panel ${st.dev ? "ON" : "OFF"}.`, { admin: true }); return; }
  if (st.turn >= MAX_TURNS) { say(st, "system", "Turn limit reached for this session. Type .s for a new one."); return; }
  // Easter eggs (2026-10-29): deterministic check, never reaches the model, costs nothing. Hits are logged on the session for abuse tracking.
  if (!low.startsWith(".")) { const egg = detectEgg(input); if (egg) { st.turn++; say(st, "user", input); const r = eggReply(egg.kind, ORIGIN); say(st, "engine", r.text, { egg: egg.kind, ...(r.image ? { image: r.image } : {}) }); (st.egg_hits ||= []).push({ turn: st.turn, kind: egg.kind, rule: egg.rule, ts: new Date().toISOString(), input: input.slice(0, 200) }); return; } }
  if (st.phase === "idle") {
    if (!/\bsimtrain\b/i.test(input)) { say(st, "system", "Type the activation word **simTrain** to begin."); return; }
    st.phase = "profile"; say(st, "engine", GREETING); return;
  }
  if (low === ".s") { st.turn++; say(st, "user", input); if (!st.profile.role) { st.phase = "profile"; say(st, "engine", GREETING); return; } P("Designing scenario…"); await startScenario(env, st); return; }
  // Continue guard: time skips only when no decision is pending, at most MAX_CONTINUES in a row. Refused continues make no model call.
  if (st.phase === "play" && CONTINUE_RE.test(input)) {
    const why = st.escalation > 0 ? "pending" : (st.continue_streak || 0) >= MAX_CONTINUES ? "streak" : null;
    if (why) { st.continue_blocked = (st.continue_blocked || 0) + 1; say(st, "system", why === "pending" ? "*The scene is waiting on you.* A decision is pending: state what you do (an action, or dialogue in \"quotes\") before time can move on." : `*Time won't skip again yet.* You've continued ${MAX_CONTINUES} times in a row; take an action, ask a question, or say something in role first.`); return; }
  }
  st.turn++; say(st, "user", input);
  if (st.phase === "profile") {
    P("Reading profile…"); const p = await chat(env, st, "profile", CORE + `\nExtract the trainee profile. Return ONLY JSON {"industry":str|null,"role":str|null,"experience":"New|Experienced|Expert"|null,"focus":str|null}. Infer industry from the role (e.g. "I manage a Wendy's" -> industry "Quick-service restaurant", role "Restaurant shift manager"). Map experience: new/trainee/rookie/first year -> New; experienced/several years/on my own -> Experienced; expert/senior/veteran/trainer/supervisor of many years -> Expert; numbers of years: <1 New, 1-5 Experienced, >5 Expert. If the input has an explicit EXPERIENCE_LEVEL line, copy it exactly. focus may be null.`, input);
    // The form's explicit choice always wins over the model's reading of it (fixes Experienced -> Intermediate).
    const formExp = (input.match(/^EXPERIENCE_LEVEL:\s*(.+)$/mi) || [])[1];
    const isForm = /^ROLE:/mi.test(input);
    if (isForm) st.profile = {}; // a new form submission replaces the previous job entirely
    st.profile = { ...st.profile, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) };
    const ex = normExp(formExp) || normExp(st.profile.experience); if (ex) st.profile.experience = ex; else delete st.profile.experience;
    if (!st.profile.focus && st.profile.role) st.profile.focus = "a realistic, common challenging situation for this job (designer chooses)";
    if (!st.profile.industry && st.profile.role) st.profile.industry = st.profile.role;
    const miss = ["role", "experience"].filter(k => !st.profile[k]);
    if (!miss.length) P("Designing scenario…");
    if (miss.length) { say(st, "engine", miss.includes("role") ? "What job do you do? Just say it in your own words (e.g. \"I run shifts at a Wendy's\")." : "How experienced are you — **New** (learning the basics), **Experienced** (work on your own) or **Expert** (train others / handle the hard cases)?"); return; }
    await startScenario(env, st); return;
  }
  if (st.phase === "ended") { say(st, "system", "Scenario complete. Type **.s** for a new scenario."); return; }
  if (low === ".end") { await finish(env, st, "trainee ended session", P); return; }
  const imgCmd = input.match(/^\.image\s+(.+)/i);
  if (imgCmd) { st.state_unchecked = (st.state_unchecked || 0) + 1; P("Rendering image…"); const img = await genImage(env, st, `${st.scenario.setting}: ${imgCmd[1]}`); const art = img && addArtifact(st, { title: imgCmd[1].slice(0, 80), kind: "image", image: img.url }); say(st, "engine", img ? `*Visual: ${imgCmd[1]}*${art ? ` (saved as ${art.id})` : ""}` : "*Image unavailable right now* (the image service didn't return one, or this run's image limit is reached). The scenario continues; try `.image` again in a moment.", img ? { image: img.url } : {}); return; }

  const fileCmd = input.match(/^\.file\s+([^\n]+)\n([\s\S]+)/i);
  if (fileCmd) {
    const art = addArtifact(st, { title: fileCmd[1].trim(), kind: "trainee document", source: "trainee", content: fileCmd[2] });
    if (!art) { say(st, "system", "File limit reached for this session."); return; }
    st.state_unchecked = (st.state_unchecked || 0) + 1;
    P("Filing document…");
    const g = await chat(env, st, "grader-artifact", GRADER, `PROFILE: ${JSON.stringify(st.profile)}\nRUBRIC: ${JSON.stringify(st.scenario?.rubric || {})}\nFUNDAMENTALS: ${JSON.stringify(st.fundamentals)}\nALREADY SATISFIED: ${JSON.stringify(st.satisfied)}\nSCENARIO TRUTH: ${st.scenario.hidden_truth}\nTHIS TURN: the trainee authored a written work product (report/affidavit/form/notes) titled "${art.title}". Grade its professional quality (accuracy vs. known facts, required elements, legal sufficiency, clarity). Set narration_consistent true. Also return "fundamentals_satisfied": [ids] that this document properly performs.\nTRAINEE INPUT:\n${art.content}`);
    for (const id of g.fundamentals_satisfied || []) { if (st.fundamentals.some(f => f.id === id) && !st.satisfied.includes(id)) { st.satisfied.push(id); (st.satisfied_turn ||= {})[id] = st.turn; } const t = st.traps.find(t => t.id === id); if (t) t.cured = true; }
    recordGrader(st, g, art.content, null);
    st.grader.filter(x => x.turn === st.turn).forEach(x => x.artifact = art.id);
    st.sim_minutes += 20;
    const cN = liveCompliance(st), cD = cN - (st._compPrev ?? cN); st._compPrev = cN;
    say(st, "engine", `*Filed **${art.id} — ${art.title}** to the case file.*\n\n---\n⚖️ Compliance **${cN}/25** (${cD > 0 ? "+" : cD < 0 ? "" : "±"}${cD}) · 🕒 ${simClock(st)}`, { artifact: art.id });
    return;
  }
  st._refs = findRefs(st, input);
  if (INJECT.test(input)) { st.state_unchecked = (st.state_unchecked || 0) + 1; say(st, "engine", "*That request is outside the simulation.* Stay in role and state your next professional action, dialogue in \"quotes\", or type **Continue**."); return; }
  const isContinue = CONTINUE_RE.test(input); st._turnStartMin = st.sim_minutes || 0;
  if (!isContinue) P("Processing…");
  const cls = isContinue ? { kind: "continue", consequential: false, summary: "advance time" } :
    await chat(env, st, "classifier", CLASSIFIER, `CONTEXT:\n${ctx(st)}\n\nTRAINEE INPUT:\n${input}`);
  for (const id of cls.fundamentals_satisfied || []) {
    if (st.fundamentals.some(f => f.id === id) && !st.satisfied.includes(id)) { st.satisfied.push(id); (st.satisfied_turn ||= {})[id] = st.turn; }
    const t = st.traps.find(t => t.id === id); if (t) t.cured = true;
  }
  // Corrections / resends of work products always get a roll line (the classifier sometimes calls them non-consequential).
  const workProduct = !isContinue && (/\n\s*\|.*\|/.test(input) || input.split("\n").length >= 6 || /\b(correct(ed|ion)|revised|amended|resend|re-send|updated)\b/i.test(input));
  if (!isContinue && !cls.consequential && (cls.kind === "action" || workProduct)) { cls.consequential = true; cls.specific_enough = true; cls.difficulty ||= "routine"; }
  if (cls.rule_violated && cls.consequential) cls.prohibited = true; // a broken state rule / law is an improper act: code caps it
  if (cls.fundamentals_required_missing) cls.fundamentals_required_missing = cls.fundamentals_required_missing.filter(id => !st.satisfied.includes(id));

  let warnEgregious = null;
  if (!isContinue && cls.egregious === true) {
    st.egregious ||= [];
    const e = { n: st.egregious.length + 1, turn: st.turn, input: input.slice(0, 300), reason: scrub(String(cls.egregious_reason || "This action is unacceptable for this job.").slice(0, 300)), correct: scrub(String(cls.correct_approach || "Stop, follow your job's established procedure, and get a supervisor involved.").slice(0, 300)), ts: new Date().toISOString() };
    st.egregious.push(e);
    if (e.n > EGREGIOUS_WARNINGS) { // third strike: no narration, no more turns; straight to the debrief
      st.ended_egregious = true;
      say(st, "engine", `## 🛑 Scenario ended\n**That was your ${e.n === 3 ? "third" : e.n + "th"} egregiously wrong action.** ${e.reason}\n\nIn a real ${st.profile?.role || "workplace"} setting you would be removed from the situation right now, so the simulation stops here. No further turns are accepted in this scenario. Your debrief follows.`, { egregious: e.n, ended: true });
      await finish(env, st, `scenario ended for egregious conduct (${e.n} egregious actions)`, P); return;
    }
    warnEgregious = e;
  }
  if (isContinue) { st.continue_streak = (st.continue_streak || 0) + 1; st.continues = (st.continues || 0) + 1; } else st.continue_streak = 0;
  let outcome, roll = null;
  if (isContinue) {
    st.friction_clock = Math.min(12, st.friction_clock + 1); st.sim_minutes += st.continue_minutes || 60;
    outcome = { mode: "continue", effects: [`Advance sim time ${st.continue_minutes || 60} minutes (no more).`, " Pending items progress realistically; inject one piece of operational friction appropriate to the friction clock (" + st.friction_clock + "/12): higher = worse (deadlines, escalating NUCs, data aging out)."] };
  } else if (cls.consequential && !cls.specific_enough && input.split(/\s+/).length < 25 && st.escalation < 3) {
    st.escalation = Math.min(3, st.escalation + 1);
    outcome = { mode: "escalation", step: st.escalation, missing_element: cls.missing_element, effects: [st.escalation >= 3 ? "SCENARIO PAUSED: refuse to advance until a professional, detailed action is articulated." : "Pause narrative; do not resolve the action."] };
  } else if (cls.consequential) {
    st.escalation = 0;
    roll = await resolve(st, cls); st.sim_minutes += roll.sim_minutes;
    outcome = { mode: "resolved", tier: roll.tier, effects: roll.effects, traps_triggered: roll.traps_triggered.length > 0 };
  } else {
    outcome = { mode: "freeform", effects: ["Non-consequential input (dialogue, question, observation). Respond in-world as the environment/NUCs. Do not grant progress-critical results that would require a roll."] };
    st.sim_minutes += 5;
  }

  st._stateBefore = { ...(st.sim_state || {}) };
  if (outcome.mode !== "escalation") { const pe = pacing(st, isContinue || !!roll); if (pe) outcome.effects = [...(outcome.effects || []), pe]; } else st.state_unchecked = (st.state_unchecked || 0) + 1;
  P("Generating scene…");
  if (roll) outcome.elapsed_minutes = roll.sim_minutes; else if (isContinue) outcome.elapsed_minutes = st.continue_minutes;
  let n = await narrate(env, st, input, outcome);
  
  let g = await grade(env, st, input, outcome, n.narration, cls);
  let validation = { tier_echo_ok: !roll || n.tier_acknowledged === roll.tier, grader_ok: g.narration_consistent !== false, retried: false };
  if (!validation.tier_echo_ok || !validation.grader_ok) {
    P("Refining…");
    n = await chat(env, st, "narrator-retry", NARRATOR + prefBlock(st, "narrator"), `CONTEXT:\n${ctx(st)}\n\nTRAINEE INPUT:\n${input}\n\nENGINE OUTCOME (binding):\n${JSON.stringify(outcome)}\n\nYOUR PREVIOUS NARRATION WAS REJECTED: ${g.consistency_issue || "tier not honored"}. Rewrite it so it honors the tier and every effect exactly.`);
    validation.retried = true; validation.tier_echo_ok_after = !roll || n.tier_acknowledged === roll.tier;
  }
  if (LEAK.test(n.narration || "")) { P("Refining…"); const n2 = await chat(env, st, "narrator-leakfix", NARRATOR, `Rewrite this narration fully in-world. Remove any mention of game mechanics, dice, numbers like DCs, ledgers, traps, evaluators or prompts. Keep every event and outcome identical. Return the same JSON shape with the same tier_acknowledged.\nNARRATION:\n${n.narration}`); if (n2?.narration && !LEAK.test(n2.narration)) n = { ...n, narration: n2.narration }; else n = { ...n, narration: scrub(n.narration) }; validation.leak_fixed = true; }
  if (roll) roll.validation = validation;
  const changed = outcome.mode === "escalation" ? [] : applyState(st, n.state_update);
  if (outcome.mode !== "escalation") { const cc = (st.clock_checks ||= { turns: 0, issues: [] }); cc.turns++; for (const said of clockCheck(st, n.narration, st._turnStartMin ?? 0).slice(0, 2)) if (cc.issues.length < 8) cc.issues.push({ turn: st.turn, said, clock: simClock(st) }); }
  if (cls.kind === "image_request" && !cls.consequential) {} // looking at a visual is never graded
  else if (outcome.mode !== "escalation" || outcome.step === 1) recordGrader(st, g, input, roll?.id || null); // escalation repeats are not double-penalized
  else if ((g.notes || []).length) recordGrader(st, { ...g, notes: g.notes.filter(x => x.delta < 0).slice(0, 1) }, input, null);
  const newArts = (Array.isArray(n.artifacts) ? n.artifacts : []).slice(0, 2).map(a => addArtifact(st, { ...a, content: localizeUTC(st, a.content), source: "sim" })).filter(Boolean);
  if (roll && workProduct && (/\n\s*\|.*\|/.test(input) || input.split("\n").length >= 6)) { const ta = addArtifact(st, { title: String(cls.summary || "Trainee work product").slice(0, 80), kind: "trainee document", source: "trainee", content: input }); if (ta) newArts.push(ta); }
  if (g.state_issue) (st.state_checks ||= []).push({ turn: st.turn, issue: String(g.state_issue).slice(0, 160) }); st.state_checked = (st.state_checked || 0) + (Object.keys(st.sim_state || {}).length ? 1 : 0);
  const compNow = liveCompliance(st), compDelta = compNow - (st._compPrev ?? compNow); st._compPrev = compNow;
  const footer = `\n\n---\n` +
    `⚖️ Compliance **${compNow}/25** (${compDelta > 0 ? "+" : compDelta < 0 ? "" : "±"}${compDelta}) · 🕒 ${simClock(st)}` + (changed.length ? "\n\n📋 **State changed:** " + changed.map(k => `${k.replace(/_/g, " ")}: ${st.sim_state[k]}`).join(" · ") : "");
  if (n.narration) n.narration = localizeUTC(st, n.narration);
  say(st, "engine", n.narration + footer + (newArts.length ? "\n\n" + newArts.map(a => `📎 **${a.id} — ${a.title}** added to Files`).join("\n") : ""), roll ? { roll: roll.id } : {});
  if (roll) say(st, "engine", rollLine(roll), { audit: true, roll: roll.id }); // backstage only: builder/instructor view and the post-.end audit
  if (warnEgregious) say(st, "system", `⚠️ **Warning ${warnEgregious.n} of ${EGREGIOUS_WARNINGS} — egregiously wrong action.** ${warnEgregious.reason}\n\n**Correct approach:** ${warnEgregious.correct}\n\n${warnEgregious.n >= EGREGIOUS_WARNINGS ? "**Final warning:** one more egregious action ends this scenario immediately." : "A third egregious action ends the scenario."}`, { egregious: warnEgregious.n });
  const imgMode = st.settings?.images || "request";
  if (cls.image_request && (imgMode === "off" || imgMode === "opening")) { say(st, "system", "Images are turned off for this run (Settings → Images)."); cls.image_request = null; }
  if (!cls.image_request && imgMode === "frequent" && roll && st.phase === "play" && (st.actions || 0) % 4 === 0) cls.image_request = firstSentence(n.narration).slice(0, 200);
  if (cls.image_request) P("Rendering image…");
  if (cls.image_request) { const img = await genImage(env, st, `${st.scenario.setting}: ${cls.image_request}`); if (img) { st.transcript[st.transcript.length - 1].image = img.url; addArtifact(st, { title: String(cls.image_request).slice(0, 80), kind: "image", image: img.url }); } else if (cls.kind === "image_request") say(st, "system", "*Image unavailable right now.* The scenario continues; try `.image <what>` again in a moment."); }
  if (st.rolls.filter(r => r.tier === "critical_failure").length >= 2) await finish(env, st, "objective catastrophically failed (two critical failures)");
}

export default {
  async fetch(req, env, ectx) {
    const res = await handle(req, env, ectx);
    const h = new Headers(res.headers); for (const [k, v] of Object.entries(SEC)) if (!h.has(k)) h.set(k, v);
    if (new URL(req.url).pathname.endsWith("/export")) h.set("content-disposition", "attachment; filename=\"simtrain-export.json\"");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
};

async function handle(req, env, ectx) {
    const url = new URL(req.url);
    const ip = ipOf(req);
    ORIGIN = url.origin;
    if (url.pathname === EGG_PATH) return Response.redirect(RICKROLL, 302);
    const H = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
    if (url.pathname === "/") return new Response(PUBLIC_HTML, { headers: H });
    if (url.pathname === "/gallery") return new Response(GALLERY_HTML, { headers: H });
    if (url.pathname === "/api/gallery") return new Response((await env.KV.get("gallery")) || "{\"runs\":[]}", { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
    if (url.pathname === "/verify") return new Response(VERIFY_HTML, { headers: H });
    if (url.pathname === "/admin") return isAdmin(req, env, url) ? new Response(HTML, { headers: H }) : new Response("not found", { status: 404 });
    if (url.pathname.startsWith("/img/")) {
      const { value, metadata } = await env.KV.getWithMetadata("img:" + url.pathname.slice(5), "arrayBuffer");
      return value ? new Response(value, { headers: { "content-type": metadata?.type || "image/webp", "cache-control": "public, max-age=86400" } }) : new Response("not found", { status: 404 });
    }
    if (url.pathname === "/api/session" && req.method === "POST") {
      if (!(await burst(env, "RL_SESSION", ip))) return J({ error: "Too many new sessions. Wait a minute." }, 429);
      if (!(await turnstileOk(env, req, req.headers.get("cf-turnstile-response")))) return J({ error: "Verification failed." }, 403);
      if (!(await bump(env, `q:s:${ip}:${dayKey()}`, LIM.sessPerDay, 172800))) return J({ error: "Daily session limit reached for your network. Try again tomorrow." }, 429);
      const id = crypto.randomUUID(); const st = newState(); st.id = id; if (url.searchParams.get("builder") === "1") st.builder = true; say(st, "system", "Type **simTrain** to activate."); await save(env, id, st); return J({ id, state: publicView(st) }); }
    const admin = isAdmin(req, env, url);
    if (url.pathname === "/api/admin/logs") {
      if (!admin) return new Response("not found", { status: 404 });
      const out = []; let cursor;
      do { const r = await env.KV.list({ prefix: "log:", cursor }); for (const k of r.keys) out.push({ id: k.name.slice(4), ...(k.metadata || {}) }); cursor = r.list_complete ? null : r.cursor; } while (cursor && out.length < 5000);
      return J({ count: out.length, sessions: out.sort((a, b) => String(b.updated).localeCompare(String(a.updated))) });
    }
    { const lm = url.pathname.match(/^\/api\/admin\/logs\/([0-9a-f-]{36})$/);
      if (lm) { if (!admin) return new Response("not found", { status: 404 }); const raw = await env.KV.get("log:" + lm[1]); return raw ? J(JSON.parse(raw)) : J({ error: "no log" }, 404); } }
    const m = url.pathname.match(/^\/api\/session\/([0-9a-f-]{36})(\/turn|\/export|\/files\/A-\d{3})?$/);
    if (m) {
      const raw = await env.KV.get("s:" + m[1]); if (!raw) return J({ error: "no session" }, 404);
      const st = JSON.parse(raw);
      if (m[2]?.startsWith("/files/")) {
        const a = (st.artifacts || []).find(x => x.id === m[2].slice(7)); if (!a) return J({ error: "not found" }, 404);
        if (a.image) return Response.redirect(new URL(a.image, url).toString(), 302);
        const body = `# ${a.id} — ${a.title}\n_${a.kind} · ${a.source === "trainee" ? "authored by trainee" : "received"} · ${a.sim_clock}_\n\n${a.content}\n`;
        return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `${url.searchParams.get("dl") ? "attachment" : "inline"}; filename="${a.id}.md"` } });
      }
      if (m[2] === "/export") {
        if (admin) return J(st);
        const pv = publicView(st, false, url.searchParams.get("builder") === "1");
        return J(st.phase === "ended" ? { title: pv.title, profile: pv.profile, transcript: pv.transcript, artifacts: pv.artifacts, scorecard: pv.final, seed: st.seed, seed_commit: st.seed_commit, rolls: st.rolls.map(({ effects, validation, ...r }) => r) } : { title: pv.title, transcript: pv.transcript, artifacts: pv.artifacts, note: "Scorecard is available after the scenario ends." });
      }
      if (m[2] === "/turn" && req.method === "POST" && url.searchParams.get("stream")) {
        const ri = await readInput(req); if (ri.err) return J({ error: ri.err === 413 ? "Message too large." : "Bad request." }, ri.err); const input = ri.input; if (ri.settings) st.settings = ri.settings;
        if (st.phase === "ended" && !/^\s*\.s\s*$/i.test(input)) return J({ error: "This scenario has ended. Read your debrief, or type .s for a new scenario.", ended: true, state: publicView(st, admin) }, 409);
        if (!admin) {
          if (!(await burst(env, "RL_TURN", ip))) return J({ error: "Slow down — too many messages per minute." }, 429);
          if (!(await bump(env, `q:t:${ip}:${dayKey()}`, LIM.turnsPerDay, 172800))) return J({ error: "Daily message limit reached for your network." }, 429);
          if (!(await bump(env, `q:g:${hourKey()}`, LIM.globalTurnsPerHour, 7200))) return J({ error: "The simulator is busy. Try again shortly." }, 503);
        }
        if (await env.KV.get("lock:" + m[1])) return J({ error: "A turn is already running for this session." }, 409);
        await env.KV.put("lock:" + m[1], "1", { expirationTtl: 60 });
        const ts = new TransformStream(); const w = ts.writable.getWriter(); const enc = new TextEncoder();
        const send = o => w.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
        const job = (async () => {
          send({ status: "Received" });
          try { await turn(env, st, input, s => send({ status: s }), admin); } catch (e) { say(st, "system", ERRMSG(e)); }
          await save(env, m[1], st); await env.KV.delete("lock:" + m[1]);
          await send({ state: publicView(st, admin, url.searchParams.get("builder") === "1") }); await w.close();
        })();
        ectx.waitUntil(job);
        return new Response(ts.readable, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache" } });
      }
      if (m[2] === "/turn" && req.method === "POST") {
        const ri = await readInput(req); if (ri.err) return J({ error: ri.err === 413 ? "Message too large." : "Bad request." }, ri.err); const input = ri.input; if (ri.settings) st.settings = ri.settings;
        if (st.phase === "ended" && !/^\s*\.s\s*$/i.test(input)) return J({ error: "This scenario has ended. Read your debrief, or type .s for a new scenario.", ended: true, state: publicView(st, admin) }, 409);
        if (!admin) {
          if (!(await burst(env, "RL_TURN", ip))) return J({ error: "Slow down — too many messages per minute." }, 429);
          if (!(await bump(env, `q:t:${ip}:${dayKey()}`, LIM.turnsPerDay, 172800))) return J({ error: "Daily message limit reached for your network." }, 429);
          if (!(await bump(env, `q:g:${hourKey()}`, LIM.globalTurnsPerHour, 7200))) return J({ error: "The simulator is busy. Try again shortly." }, 503);
        }
        if (await env.KV.get("lock:" + m[1])) return J({ error: "A turn is already running for this session." }, 409);
        await env.KV.put("lock:" + m[1], "1", { expirationTtl: 60 });
        try { await turn(env, st, input, undefined, admin); } catch (e) { say(st, "system", ERRMSG(e)); }
        await save(env, m[1], st); await env.KV.delete("lock:" + m[1]);
      }
      return J({ id: m[1], state: publicView(st, admin, url.searchParams.get("builder") === "1") });
    }
    return new Response("not found", { status: 404 });
}
