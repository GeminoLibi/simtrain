// Easter-egg defenses (2026-10-29). Deterministic, server-side, no model call, no credits.
// Order: DUMP (system-prompt / internals extraction) is checked before JAILBREAK (prompt-engineering).
export const EGG_GIF = "https://media.giphy.com/media/5ftsmLIqktHQA/giphy.gif"; // Dennis Nedry "Ah ah ah", Giphy CDN
export const RICKROLL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
export const EGG_PATH = "/sys";

const norm = s => String(s || "").normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "").replace(/\s+/g, " ").trim();

const V = "(?:show|print|repeat|reveal|display|output|dump|give|tell|list|share|leak|paste|echo|recite|copy|spell out|write out|send|expose|disclose|return)";
const SECRET = "(?:system ?prompt|sys ?prompt|(?:initial|original|hidden|base|developer|meta) (?:prompt|instructions)|your (?:instructions|prompts?|rules|config(?:uration)?|guidelines|directives|programming|settings|internals|source code)|(?:hidden|secret) (?:rolls?|dice|dcs?|truth|instructions|rubric|notes|state)|(?:dice|hidden|your|my|d20) rolls?|(?:the |my |your )?rolls? (?:you made|you rolled|behind the scenes)|(?:the |your )?dcs? (?:for|of|on)|difficulty class(?:es)?|(?:rng|random|game|roll|dice|your|hidden) seed|seed (?:value|number|commit)|answer key|hidden truth|grading rubric|trap ledger|api[ _-]?keys?|secret keys?|access keys?|env(?:ironment)? (?:vars|variables)|model (?:internals|weights|config(?:uration)?|parameters|settings))";
const DUMP = [
  new RegExp(`\\b${V}\\b.{0,40}\\b${SECRET}\\b`, "i"),
  /\bwhat(?:'s| is| are| were)\b.{0,20}\b(?:your|the) (?:system ?prompt|hidden (?:rolls?|dcs?|truth)|api[ _-]?keys?|dice rolls?|(?:rng |random )?seed|dcs?(?: for| of| on|\?|$))/i,
  /\b(?:repeat|print|output|recite)\b.{0,30}\b(?:everything|all|the (?:text|words|messages?)) (?:above|before|preceding|so far)\b/i,
  /\b(?:verbatim|word for word)\b.{0,40}\b(?:prompt|instructions|rules|above)\b/i,
  /\bsystem ?prompt\b/i,
  /\bapi[ _-]?keys?\b/i,
];

const JAIL = [
  /\b(?:ignore|disregard|forget|override|bypass|discard|drop|abandon)\b.{0,30}\b(?:previous|prior|above|earlier|preceding|original|initial|system|all (?:your|the|previous)|your)\b.{0,20}\b(?:instructions?|prompts?|rules|directions|guidelines|directives|context|programming|constraints|guardrails|restrictions)\b/i,
  /\b(?:ignore|disregard|forget) (?:all|everything) (?:above|before|previous(?:ly)?|prior)\b/i,
  /\byou are (?:now|no longer)\b.{0,25}\b(?:dan|an? (?:ai|assistant|chatbot|language model|llm|bot)|unrestricted|unfiltered|uncensored|jailbroken|free|freed|not bound|without (?:rules|restrictions|limits)|in (?:developer|dev|god|admin|debug) mode|bound by)\b/i,
  /\bfrom now on\b.{0,40}\b(?:you (?:are|will|must|shall)|act as|respond as|answer as|pretend)\b.{0,40}\b(?:ai|assistant|chatbot|model|unrestricted|unfiltered|uncensored|no (?:rules|restrictions|limits|filters)|dan)\b/i,
  /\bDAN\b(?: mode)?|\bdo anything now\b/,
  /\b(?:developer|dev|god|debug|admin|sudo|jailbreak|unrestricted) mode\b/i,
  /\bjail ?break(?:ing|s)?\b/i,
  /\b(?:act|pretend|roleplay|role-play|behave)\b(?: as| to be| that you are| you(?:'re| are))? (?:an? |the )?(?:unrestricted|unfiltered|uncensored|evil|different|new|rogue|base) (?:ai|model|assistant|chatbot|llm|bot)\b/i,
  /\b(?:pretend|imagine) (?:that )?(?:you(?:'re| are)|to be) (?:an? |the )?(?:ai|chatgpt|gpt|llama|gemini|claude|grok|language model|llm|developer|admin|system)\b/i,
  /(?:^|\n)\s*(?:\[|<|<\|)?\s*(?:system|developer|sys|im_start)\s*(?:\]|>|\|>)?\s*:.{0,60}\b(?:you (?:are|must|will|should)|ignore|override|grant|give (?:the )?(?:user|trainee)|the (?:user|trainee|assistant)|new instructions|respond|full marks|perfect score|100 ?\/ ?100|pass(?:ed)?)\b/i,
  /<\|?(?:im_start|im_end|system|endoftext)\|?>|\[\/?(?:INST|SYS)\]|<<\/?SYS>>|###\s*(?:system|instruction|new instructions)/i,
  /\b(?:new|updated|real|actual|override) (?:system )?(?:instructions|rules|directives)\s*:/i,
  /\b(?:your|the) (?:new|real|true|actual) (?:instructions|rules|purpose|directive)s? (?:are|is)\b/i,
  /\b(?:stop|quit|exit) (?:being|acting as|pretending to be) (?:a |the |an )?(?:simulat(?:or|ion)|game|narrator|trainer|ai)\b/i,
  /\b(?:prompt injection|prompt engineering|token smuggling)\b/i,
];

export function detectEgg(raw) {
  const s = norm(raw);
  if (!s || s.length < 6) return null;
  if (/^(?:ROLE|INDUSTRY|EXPERIENCE_LEVEL|SCENARIO_FOCUS):/m.test(s) && !/system ?prompt|ignore|jailbreak|\bDAN\b/i.test(s)) return null;
  const unq = s.replace(/"[^"]*"|“[^”]*”/g, " ");
  for (const [i, r] of DUMP.entries()) if (r.test(i <= 1 ? unq : s)) return { kind: "dump", rule: r.source.slice(0, 60) };
  const multi = String(raw || ""); // fake system-message checks need line starts
  for (const r of JAIL) if (r.test(s) || r.test(multi)) return { kind: "jailbreak", rule: r.source.slice(0, 60) };
  return null;
}

export function eggReply(kind, origin) {
  if (kind === "dump") return { text: `🔒 Nice try. The rulebook stays backstage. Here's what's behind the curtain instead: [${origin}${EGG_PATH}](${origin}${EGG_PATH})` };
  return { text: "**Ah ah ah — you didn't say the magic word!** Access denied. Stay in role and state your next action.", image: EGG_GIF };
}
