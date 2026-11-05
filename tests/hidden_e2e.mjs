import worker from "./worker.js";
const kv=new Map();
const KV={list:async({prefix})=>({keys:[...kv.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name,metadata:kv.get(name).m})),list_complete:true}),get:async(k,t)=>{const v=kv.get(k);return v?.v??null},put:async(k,v,o)=>kv.set(k,{v,m:o?.metadata}),delete:async k=>kv.delete(k),getWithMetadata:async k=>({value:kv.get(k)?.v??null,metadata:kv.get(k)?.m})};
let mode={prohibited:false,setupN:0}; const setups=[];
globalThis.fetch=async(url,o)=>{const b=JSON.parse(o.body);const sys=b.messages?.[0].content||"";let out;
 if(sys.includes("SCENARIO DESIGNER")){setups.push(b.messages[1].content);mode.setupN++;out={title:"Game "+mode.setupN,setting:"Ballpark",start_clock:"2026-09-19T19:05",timezone_label:"ET",turn_minutes:3,continue_minutes:15,utc_offset_minutes:-240,state_title:"Game state",stateful:true,state:{inning:"Top 7",outs:1,batters_faced_by_current_pitcher:0},state_rules:["reliever must face 3 batters"],briefing:"b",objective:"win",hidden_truth:"h",fundamentals:[{id:"F1",step:"check bullpen",framework:"x",domain:"technical"}],nucs:[{name:"N"+mode.setupN,role:"c",disposition:"d"}],rubric:{}}}
 else if(sys.includes("Extract the trainee profile")) out={role:"baseball manager",experience:"Intermediate",industry:"MLB"};
 else if(sys.includes("ACTION CLASSIFIER")) out={kind:mode.nonc?"other":"action",consequential:!mode.nonc,elapsed_minutes:mode.nonc?4:1,specific_enough:true,summary:mode.prohibited?"Pull reliever after 1 batter":"Bring in lefty",rubric:{procedure:3,framework:3,specificity:3},difficulty:"standard",prohibited:false,rule_violated:mode.prohibited?"3-batter minimum":null,fundamentals_satisfied:[],fundamentals_required_missing:[]};
 else if(sys.includes("ROLE: NARRATOR")) out={narration:"The pitch is thrown.",state_update:{outs:2,bogus:1},artifacts:mode.nonc?[{title:"Pitch log",kind:"log",content:"23:10 pitch at 2026-09-19T23:10:00Z"}]:[],tier_acknowledged:"x"};
 else if(sys.includes("simTrain GRADER writing")) out={feedback:"DEBRIEF TEXT"};
 else out={narration_consistent:true,notes:[{domain:"compliance",delta:1,evidence:"lefty",rationale:"ok"}],missed_steps:mode.nonc?["note the pitch count on the card"]:[],state_issue:mode.nonc?"outs not updated":null};
 if(url.includes("images")) return new Response("{}",{status:500});
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(out)}}],usage:{prompt_tokens:10,completion_tokens:10}}));};
const env={KV,META_BASE:"http://m",TEXT_MODEL:"t",IMAGE_MODEL:"i",SPEND_CAP_USD:"15",META_API_KEY:"x",ADMIN_TOKEN:"t0k-test"};
const ctx={waitUntil(){}};
const call=async(p,body)=>{const r=await worker.fetch(new Request("http://x"+p,{method:body?"POST":"GET",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined}),env,ctx);return [r,await r.json().catch(()=>null)]};

import assert from "node:assert/strict";
const MECH=/\b(d20|DC ?\d+|dice|die roll|roll(ed|s)?|seed|mastery floor|natural (1|20)|modifier)\b|🎲/i;
const visible=st=>st.transcript.map(m=>m.text).join("\n");
// trainee session
let [,s]=await call("/api/session",{}); let id=s.id; let T=i=>call(`/api/session/${id}/turn?builder=1`,{input:i});
await T("simTrain"); await T("INDUSTRY: \nROLE: baseball manager\nEXPERIENCE_LEVEL: Experienced\nSCENARIO_FOCUS: ");
let [,r]=await T("I bring in the lefty from the bullpen to face their lefty slugger.");
mode.prohibited=true; [,r]=await T("I pull the reliever after one batter."); mode.prohibited=false;
mode.nonc=true; [,r]=await T("Corrected lineup card:\n| 1 | Ruiz | CF |\n| 2 | Park | SS |"); mode.nonc=false;
assert.ok(!MECH.test(visible(r.state)), "trainee sees mechanics during play: "+(visible(r.state).match(MECH)||[])[0]);
assert.equal(r.state.seed_commit, undefined); assert.equal(r.state.rolls, undefined);
const [,mid]=await call(`/api/session/${id}/export`); assert.ok(!MECH.test(JSON.stringify(mid.transcript)));
// admin always sees the backstage roll lines
const [,ad]=await (async()=>{const q=await worker.fetch(new Request(`http://x/api/session/${id}`,{headers:{"x-simtrain-admin":"t0k-test"}}),env,ctx);return [q,await q.json()]})();
assert.ok(ad.state.transcript.some(m=>m.audit && /DC/.test(m.text)) && ad.state.seed_commit);
[,r]=await T(".end"); const after=visible(r.state);
assert.ok(/Roll audit/.test(after) && /Grader vs tracker/.test(after) && /Decision vs luck/.test(after), "debrief shows audit after .end");
const card=r.state.transcript.find(m=>m.text.startsWith("## Scorecard")).text; assert.ok(!/\bR\d+\b/.test(card),"scorecard has no roll ids");
console.log("PASS trainee hidden / admin visible / .end audit");
// builder session (?builder=1) shows backstage lines during play
[,s]=await call("/api/session?builder=1",{}); id=s.id; T=i=>call(`/api/session/${id}/turn?builder=1`,{input:i});
await T("simTrain"); await T("INDUSTRY: \nROLE: baseball manager\nEXPERIENCE_LEVEL: Experienced\nSCENARIO_FOCUS: ");
[,r]=await T("I bring in the lefty from the bullpen to face their lefty slugger.");
assert.ok(r.state.builder && r.state.transcript.some(m=>m.audit && /DC/.test(m.text)) && r.state.seed_commit);
{const q=await worker.fetch(new Request(`http://x/api/session/${id}`),env,ctx);const j=await q.json();assert.ok(!j.state.transcript.some(m=>m.audit),"builder session via public route without ?builder=1 must not leak audit");}
console.log("PASS builder mode (and no leak on public route)");
// durable log: admin-only, no expiry
const L=async(p,h)=>{const q=await worker.fetch(new Request("http://x"+p,{headers:h||{}}),env,ctx);return [q.status,q.status===200?await q.json():null]};
assert.equal((await L("/api/admin/logs"))[0],404);
const [st1,list]=await L("/api/admin/logs",{"x-simtrain-admin":"t0k-test"}); assert.equal(st1,200); assert.equal(list.count,2);
const [,one]=await L(`/api/admin/logs/${list.sessions.find(x=>!x.builder).id}`,{"x-simtrain-admin":"t0k-test"});
assert.ok(one.rolls.length>=3 && one.final && one.transcript.length>5 && !/META_API_KEY|t0k-test/.test(JSON.stringify(one)));
console.log("PASS admin log viewer");
// luck vs decision
const { luckClass, score } = await import("../src/engine.js");
const good={id:"R1",tier:"failure",mod_parts:{procedure:3,specificity:3,prereq_penalty:0}}, shaky={id:"R2",tier:"success",mod_parts:{procedure:1,specificity:1,prereq_penalty:-2}};
assert.equal(luckClass(good),"bad_break"); assert.equal(luckClass(shaky),"lucky"); assert.equal(luckClass({...good,tier:"success"}),null);
const base={rolls:[good],traps:[],fundamentals:[],satisfied:[],artifacts:[],grader:[{id:"G1",domain:"technical",delta:-3,roll:"R1"},{id:"G2",domain:"critical",delta:-2,roll:"R1"}]};
const sc=score(base); assert.deepEqual(sc.luck_excluded,["G1","G2"]); assert.equal(sc.detail.technical.ledger_sum,0);
console.log("PASS luck vs decision");
