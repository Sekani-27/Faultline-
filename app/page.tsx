"use client";

import { useEffect, useMemo, useState } from "react";
import { evidenceDebt, evaluateScenario, scenarios } from "../lib/faultline-engine";

type View = "Investigation" | "Sources" | "Evidence" | "Debt" | "Package";

type GitHubEvent = { id:string; kind:"commit"|"workflow"|"deployment"|"pull_request"; title:string; detail:string; at:string; url:string; status:string };
type GitHubSource = { repository:{fullName:string;url:string;branch:string;visibility:string;updatedAt:string}; events:GitHubEvent[]; counts:{commits:number;workflows:number;deployments:number;pullRequests:number}; syncedAt:string; syncMode:"live"|"verified-snapshot" };

function Pill({ value }: { value: string }) {
  const cls = value === "Supported" ? "positive" : value === "Contradicted" ? "negative" : "neutral";
  return <span className={`status ${cls}`}>{value}</span>;
}

export default function Home() {
  const [scenarioId,setScenarioId] = useState(scenarios[0].id);
  const [claimId,setClaimId] = useState("deployment");
  const [view,setView] = useState<View>("Investigation");
  const [debtStatus,setDebtStatus] = useState("proposed");
  const [reviewed,setReviewed] = useState(false);
  const [saved,setSaved] = useState("Loading saved investigation…");
  const [github,setGithub] = useState<GitHubSource|null>(null);
  const [syncing,setSyncing] = useState(false);
  const [sourceError,setSourceError] = useState("");
  const scenario = scenarios.find(s=>s.id===scenarioId) ?? scenarios[0];
  const results = useMemo(()=>evaluateScenario(scenario),[scenario]);
  const debts = useMemo(()=>evidenceDebt(scenario),[scenario]);
  const selected = results.find(c=>c.id===claimId) ?? results[0];
  const leading = results[0];

  useEffect(()=>{
    fetch("/api/state").then(r=>r.json()).then(({state})=>{
      if(state){ setScenarioId(state.scenario_id); setClaimId(state.selected_claim_id); setDebtStatus(state.debt_status); setReviewed(Boolean(state.reviewed)); setSaved(`Restored · ${new Date(state.updated_at).toLocaleString()}`); }
      else setSaved("No saved investigation yet");
    }).catch(()=>setSaved("Persistence available after deployment"));
  },[]);

  async function syncGitHub() {
    setSyncing(true); setSourceError("");
    try {
      const response = await fetch("/api/github");
      const data = await response.json() as GitHubSource & {error?:string};
      if(!response.ok) throw new Error(data.error || "GitHub sync failed");
      setGithub(data);
    } catch(error) { setSourceError(error instanceof Error ? error.message : "GitHub sync failed"); }
    finally { setSyncing(false); }
  }

  useEffect(()=>{ void syncGitHub(); },[]);

  async function saveState(next?: Partial<{debtStatus:string;reviewed:boolean}>) {
    const payload = {scenarioId,selectedClaimId:claimId,debtStatus:next?.debtStatus ?? debtStatus,reviewed:next?.reviewed ?? reviewed};
    setSaved("Saving…");
    try { const res=await fetch("/api/state",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}); const data=await res.json(); setSaved(`Saved · ${new Date(data.updatedAt).toLocaleTimeString()}`); }
    catch { setSaved("Save unavailable in this environment"); }
  }

  function changeScenario(id:string){ setScenarioId(id); const next=evaluateScenario(scenarios.find(s=>s.id===id) ?? scenarios[0])[0]; setClaimId(next.id); setReviewed(false); }

  return <main className="core-shell">
    <aside className="core-sidebar">
      <div className="brand"><span className="brand-mark">F</span><div><strong>Faultline</strong><small>Causal Evidence System</small></div></div>
      <span className="eyebrow side-label">WORKSPACE</span>
      {(["Investigation","Sources","Evidence","Debt","Package"] as View[]).map(item=><button key={item} className={view===item?"active":""} onClick={()=>setView(item)}><span>{item[0]}</span>{item}{item==="Debt"&&<em>{debts.length}</em>}{item==="Sources"&&<i className="source-live"/>}</button>)}
      <div className="engine-note"><i/>Deterministic engine<strong>Ruleset v1.0</strong><small>No model-generated verdicts</small></div>
    </aside>

    <section className="core-workspace">
      <header className="core-topbar">
        <div><span className="eyebrow">ACTIVE RECONSTRUCTION</span><strong>{scenario.title}</strong></div>
        <div className="save-state"><span>{saved}</span><button className="ghost" onClick={()=>saveState()}>Save state</button></div>
      </header>

      <div className="scenario-switcher" aria-label="Incident scenarios">
        {scenarios.map(s=><button key={s.id} className={scenarioId===s.id?"active":""} onClick={()=>changeScenario(s.id)}><span>{s.shortName}</span><small>{s.severity} · {s.window}</small></button>)}
      </div>

      {view==="Investigation"&&<div className="core-content">
        <section className="case-head">
          <div><span className="eyebrow">{scenario.severity} · {scenario.window}</span><h1>{scenario.title}</h1><p>{scenario.impact}. Faultline tests the same three explanations against this incident’s evidence.</p></div>
          <div className="verdict-card"><span>LEADING EXPLANATION</span><strong>{leading.title}</strong><Pill value={leading.status}/><small>Computed from {scenario.evidence.length} observations</small></div>
        </section>

        <section className="score-strip">
          {results.map((result,index)=><button key={result.id} className={claimId===result.id?"selected":""} onClick={()=>setClaimId(result.id)}><div><span>CLM-0{index+1}</span><Pill value={result.status}/></div><strong>{result.title}</strong><footer><b>{result.score>0?"+":""}{result.score}</b><small>weighted score</small><i style={{width:`${Math.max(8,Math.min(100,(result.score+6)*7))}%`}}/></footer></button>)}
        </section>

        <div className="core-grid">
          <article className="panel rule-panel">
            <div className="panel-head"><div><span className="eyebrow">RULE TRACE</span><h2>{selected.title}</h2></div><Pill value={selected.status}/></div>
            <div className="trace-summary"><div><span>SCORE</span><strong>{selected.score>0?"+":""}{selected.score}</strong></div><div><span>CONFIDENCE</span><strong>{selected.confidence}</strong></div><div><span>EVIDENCE GAPS</span><strong>{selected.gaps.length}</strong></div></div>
            <div className="rules-table">
              <div className="rule-head"><span>RULE</span><span>OBSERVED EVIDENCE</span><span>RESULT</span><span>WEIGHT</span></div>
              {selected.rules.map(rule=>{const ev=scenario.evidence.find(e=>e.signal===rule.signal); const match=ev?.value===rule.expected; return <div className="rule-row" key={rule.signal}><span>{rule.rationale}</span><strong>{ev?.observation ?? "No observation available"}<small>{ev?.source ?? "Evidence gap"}</small></strong><em className={!ev?"missing":match?"pass":"fail"}>{!ev?"GAP":match?"PASS":"CONTRADICTS"}</em><b>{ev?(match?"+":"−")+rule.weight:"—"}</b></div>})}
            </div>
            <div className="bounded-conclusion"><span>DETERMINISTIC CONCLUSION</span><p>{selected.status==="Supported"?"All necessary observations align with this explanation and no material rule is contradicted.":selected.status==="Contradicted"?"The evidence conflicts with one or more necessary predictions of this explanation.":"Some observations align, but contradictions or missing necessary evidence prevent support."}</p></div>
          </article>

          <aside className="panel engine-panel"><span className="eyebrow">HOW THIS VERDICT WAS MADE</span><h2>Inspectable, not inferred by AI.</h2><ol><li><b>1</b><div><strong>Normalize observations</strong><small>Each source maps to a typed signal.</small></div></li><li><b>2</b><div><strong>Evaluate claim rules</strong><small>Expected values are compared exactly.</small></div></li><li><b>3</b><div><strong>Apply fixed weights</strong><small>Support adds; contradiction subtracts.</small></div></li><li><b>4</b><div><strong>Bound the conclusion</strong><small>Missing required signals become debt.</small></div></li></ol><button className="ghost full" onClick={()=>setView("Evidence")}>Inspect source evidence →</button></aside>
        </div>
      </div>}

      {view==="Sources"&&<div className="core-content">
        <div className="page-heading"><div><span className="eyebrow">EVIDENCE SOURCE CONNECTIONS</span><h1>GitHub is connected to Faultline.</h1><p>Repository activity is normalized into source evidence with direct provenance.</p></div><button className="primary" onClick={syncGitHub} disabled={syncing}>{syncing?"Syncing…":"↻ Sync GitHub"}</button></div>
        <section className="source-connection panel">
          <div className="source-logo">GH</div><div className="source-identity"><span>CONNECTED REPOSITORY</span><h2>{github?.repository.fullName ?? "Sekani-27/Nexara"}</h2><a href={github?.repository.url ?? "https://github.com/Sekani-27/Nexara"} target="_blank" rel="noreferrer">Open repository ↗</a></div>
          <div className="connection-state"><i/><strong>{sourceError?"Connection degraded":github?.syncMode==="verified-snapshot"?"Connected · verified snapshot":"Connected · live"}</strong><small>{github?`${github.syncMode==="live"?"Last synced":"Last verified"} ${new Date(github.syncedAt).toLocaleString()}`:"Establishing connection…"}</small></div>
        </section>
        {sourceError&&<div className="source-error"><strong>GitHub could not be refreshed.</strong><span>{sourceError}</span><button onClick={syncGitHub}>Try again</button></div>}
        <section className="source-stats">
          <article><span>COMMITS</span><strong>{github?.counts.commits ?? "—"}</strong><small>Recent main-branch changes</small></article><article><span>WORKFLOW RUNS</span><strong>{github?.counts.workflows ?? "—"}</strong><small>Build and deployment evidence</small></article><article><span>DEPLOYMENTS</span><strong>{github?.counts.deployments ?? "—"}</strong><small>Environment transitions</small></article><article><span>PULL REQUESTS</span><strong>{github?.counts.pullRequests ?? "—"}</strong><small>Review provenance</small></article>
        </section>
        <section className="panel source-feed"><div className="panel-head"><div><span className="eyebrow">NORMALIZED SOURCE FEED</span><h2>Evidence available for incident correlation</h2></div><span className="data-count">{github?.events.length ?? 0} source records</span></div>
          <div className="feed-head"><span>TYPE</span><span>EVENT</span><span>STATUS</span><span>TIME</span><span>PROVENANCE</span></div>
          {github?.events.map(event=><div className="feed-row" key={`${event.kind}-${event.id}`}><em className={`event-kind ${event.kind}`}>{event.kind.replace("_"," ")}</em><div><strong>{event.title}</strong><small>{event.detail}</small></div><b>{event.status}</b><time>{new Date(event.at).toLocaleString()}</time><a href={event.url} target="_blank" rel="noreferrer">Inspect ↗</a></div>)}
          {!github&&!sourceError&&<div className="source-loading">Reading repository evidence…</div>}
        </section>
        <aside className="correlation-note"><strong>Why GitHub evidence does not automatically become “the cause”</strong><p>Faultline imports deployments, commits and workflow outcomes as observations. They influence a claim only after their time, service and release identity match the incident being investigated.</p></aside>
      </div>}

      {view==="Evidence"&&<div className="core-content">
        <div className="page-heading"><div><span className="eyebrow">CANONICAL EVENT MODEL</span><h1>One evidence shape. Different source systems.</h1><p>The engine consumes typed signals, never source-specific presentation data.</p></div><span className="data-count">{scenario.evidence.length} normalized observations</span></div>
        <section className="panel source-table"><div className="source-head"><span>TIME</span><span>OBSERVATION</span><span>SOURCE</span><span>SIGNAL</span><span>VALUE</span><span>QUALITY</span></div>{scenario.evidence.map(ev=><div key={ev.id}><time>{ev.at}</time><strong>{ev.observation}</strong><span>{ev.source}</span><code>{ev.signal}</code><em>{String(ev.value)}</em><b>{ev.quality}</b></div>)}</section>
      </div>}

      {view==="Debt"&&<div className="core-content">
        <div className="page-heading"><div><span className="eyebrow">AUTO-GENERATED EVIDENCE DEBT</span><h1>Unknowns become instrumentation work.</h1><p>Items appear only when a necessary claim signal is absent.</p></div><span className="data-count">{debts.length} gaps detected</span></div>
        <div className="debt-core-grid"><section className="panel debt-list">{debts.map((debt,index)=><article key={debt.id}><div><span>{debt.id} · PRIORITY {index===0?"HIGH":"MEDIUM"}</span><h2>{debt.title}</h2><p>{debt.reason}</p><code>{debt.signal}</code></div><button className={debtStatus==="accepted"?"primary":"ghost"} onClick={()=>{setDebtStatus("accepted");saveState({debtStatus:"accepted"})}}>{debtStatus==="accepted"?"Accepted":"Accept debt"}</button></article>)}</section><aside className="panel debt-explain"><span className="eyebrow">GENERATION LOGIC</span><h2>Required − observed = debt</h2><p>Faultline unions the required signals across competing claims, subtracts available evidence, then creates one actionable item for every missing capability.</p><div><strong>{scenario.evidence.length}</strong><small>observations</small><b>→</b><strong>{debts.length}</strong><small>evidence gaps</small></div></aside></div>
      </div>}

      {view==="Package"&&<div className="core-content">
        <div className="page-heading"><div><span className="eyebrow">INCIDENT EVIDENCE PACKAGE</span><h1>A reviewable record of what is known.</h1><p>Generated from the current scenario, computed outcomes, and saved review state.</p></div></div>
        <div className="package-core-grid"><article className="panel package-core"><span className="eyebrow">FAULTLINE / {scenario.id.toUpperCase()}</span><h2>{scenario.title}</h2><div className="package-meta"><span>{scenario.severity}</span><span>{scenario.window}</span><span>{scenario.impact}</span></div><section><span>01</span><div><h3>Leading explanation</h3><p>{leading.title}</p><Pill value={leading.status}/></div></section><section><span>02</span><div><h3>Competing claims</h3>{results.map(c=><div className="package-row" key={c.id}><strong>{c.title}</strong><Pill value={c.status}/><b>{c.score>0?"+":""}{c.score}</b></div>)}</div></section><section><span>03</span><div><h3>Known evidence limits</h3><p>{debts.length} required signal{debts.length===1?" is":"s are"} absent. Maximum confidence is bounded accordingly.</p></div></section></article><aside className="panel review-core"><span className="eyebrow">HUMAN REVIEW</span><h2>{reviewed?"Package adopted":"Decision required"}</h2><p>The engine proposes an assessment. A human remains accountable for adopting it.</p><button className="primary full" onClick={()=>{setReviewed(true);saveState({reviewed:true})}}>{reviewed?"✓ Adopted by reviewer":"Adopt evidence package"}</button>{reviewed&&<div className="review-record"><span>DECISION RECORDED</span><strong>Aiden Mokoena</strong><small>Persisted with the investigation state</small></div>}</aside></div>
      </div>}
    </section>
  </main>;
}
