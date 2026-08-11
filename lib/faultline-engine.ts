export type Signal =
  | "release_change" | "traffic_above_baseline" | "dependency_errors"
  | "service_only_impact" | "multi_client_impact" | "rollback_recovery"
  | "scale_recovery" | "dependency_recovery" | "connection_growth";

export type Evidence = {
  id: string; at: string; observation: string; source: string;
  signal: Signal; value: boolean; quality: "high" | "medium";
};

export type Scenario = {
  id: string; shortName: string; title: string; severity: string; window: string;
  impact: string; evidence: Evidence[];
};

export type Rule = { signal: Signal; expected: boolean; weight: number; rationale: string };
export type ClaimDefinition = { id: string; title: string; rules: Rule[]; required: Signal[] };

export const scenarios: Scenario[] = [
  {
    id: "bad-deployment", shortName: "Bad deployment", title: "Checkout failures following v2.8.1", severity: "SEV-1", window: "14:20–14:39", impact: "38% checkout failures",
    evidence: [
      { id:"ev-101",at:"14:20",observation:"Checkout v2.8.1 deployment completed",source:"GitHub Actions",signal:"release_change",value:true,quality:"high" },
      { id:"ev-102",at:"14:24",observation:"Connections rose only on v2.8.1 pods",source:"Prometheus",signal:"service_only_impact",value:true,quality:"high" },
      { id:"ev-103",at:"14:27",observation:"Pool occupancy reached 96%",source:"Prometheus",signal:"connection_growth",value:true,quality:"high" },
      { id:"ev-104",at:"14:30",observation:"Traffic remained inside its normal band",source:"Grafana",signal:"traffic_above_baseline",value:false,quality:"high" },
      { id:"ev-105",at:"14:36",observation:"Rollback completed; recovery followed",source:"Argo CD",signal:"rollback_recovery",value:true,quality:"high" },
      { id:"ev-106",at:"14:38",observation:"Other database clients stayed healthy",source:"Datadog",signal:"multi_client_impact",value:false,quality:"medium" },
    ],
  },
  {
    id: "traffic-surge", shortName: "Traffic surge", title: "Flash-sale capacity exhaustion", severity: "SEV-2", window: "09:01–09:26", impact: "p95 latency 8.4s",
    evidence: [
      { id:"ev-201",at:"09:01",observation:"Requests reached 4.7× seasonal baseline",source:"Cloudflare Analytics",signal:"traffic_above_baseline",value:true,quality:"high" },
      { id:"ev-202",at:"09:04",observation:"All checkout versions saturated equally",source:"Prometheus",signal:"service_only_impact",value:false,quality:"high" },
      { id:"ev-203",at:"09:06",observation:"No production release occurred",source:"Argo CD",signal:"release_change",value:false,quality:"high" },
      { id:"ev-204",at:"09:12",observation:"Database and cache stayed healthy",source:"Datadog",signal:"dependency_errors",value:false,quality:"high" },
      { id:"ev-205",at:"09:21",observation:"Horizontal scale-out preceded recovery",source:"Kubernetes",signal:"scale_recovery",value:true,quality:"high" },
    ],
  },
  {
    id: "dependency-failure", shortName: "Dependency failure", title: "Regional payment gateway degradation", severity: "SEV-1", window: "18:42–19:18", impact: "61% payment initiation failures",
    evidence: [
      { id:"ev-301",at:"18:42",observation:"Gateway 5xx rate rose across three clients",source:"OpenTelemetry",signal:"dependency_errors",value:true,quality:"high" },
      { id:"ev-302",at:"18:44",observation:"Unrelated gateway clients failed concurrently",source:"Synthetic probes",signal:"multi_client_impact",value:true,quality:"high" },
      { id:"ev-303",at:"18:46",observation:"Request volume remained normal",source:"Cloudflare Analytics",signal:"traffic_above_baseline",value:false,quality:"high" },
      { id:"ev-304",at:"18:48",observation:"No checkout release occurred",source:"Argo CD",signal:"release_change",value:false,quality:"high" },
      { id:"ev-305",at:"19:16",observation:"Gateway recovery preceded client recovery",source:"Status API + traces",signal:"dependency_recovery",value:true,quality:"medium" },
    ],
  },
];

export const claimDefinitions: ClaimDefinition[] = [
  { id:"deployment", title:"A production change introduced the failure", required:["release_change","rollback_recovery"], rules:[
    {signal:"release_change",expected:true,weight:3,rationale:"A relevant change preceded impact"},
    {signal:"service_only_impact",expected:true,weight:2,rationale:"Changed cohort differs from controls"},
    {signal:"rollback_recovery",expected:true,weight:3,rationale:"Reversal preceded recovery"},
    {signal:"traffic_above_baseline",expected:false,weight:1,rationale:"Demand did not explain the change"},
  ]},
  { id:"traffic", title:"Demand exceeded available service capacity", required:["traffic_above_baseline","scale_recovery"], rules:[
    {signal:"traffic_above_baseline",expected:true,weight:4,rationale:"Demand exceeded the operating baseline"},
    {signal:"scale_recovery",expected:true,weight:3,rationale:"Added capacity preceded recovery"},
    {signal:"release_change",expected:false,weight:1,rationale:"No confounding release occurred"},
  ]},
  { id:"dependency", title:"A shared dependency initiated the outage", required:["dependency_errors","multi_client_impact","dependency_recovery"], rules:[
    {signal:"dependency_errors",expected:true,weight:3,rationale:"Dependency errors preceded client impact"},
    {signal:"multi_client_impact",expected:true,weight:3,rationale:"Independent clients failed together"},
    {signal:"dependency_recovery",expected:true,weight:2,rationale:"Dependency recovery preceded client recovery"},
    {signal:"traffic_above_baseline",expected:false,weight:1,rationale:"Demand remained normal"},
  ]},
];

export function evaluateScenario(scenario: Scenario) {
  const signals = new Map(scenario.evidence.map(e => [e.signal, e]));
  return claimDefinitions.map(claim => {
    const evaluated = claim.rules.flatMap(rule => {
      const evidence = signals.get(rule.signal);
      return evidence ? [{...rule, evidence, matches: evidence.value === rule.expected}] : [];
    });
    const support = evaluated.filter(r => r.matches);
    const contradictions = evaluated.filter(r => !r.matches);
    const score = support.reduce((n,r)=>n+r.weight,0) - contradictions.reduce((n,r)=>n+r.weight,0);
    const gaps = claim.required.filter(signal => !signals.has(signal));
    const status = score >= 5 && contradictions.length === 0 ? "Supported" : score <= 0 ? "Contradicted" : "Insufficient evidence";
    const confidence = gaps.length === 0 && evaluated.filter(r=>r.evidence.quality === "high").length >= 2 ? "High" : "Medium";
    return { ...claim, score, status, confidence, support, contradictions, gaps };
  }).sort((a,b)=>b.score-a.score);
}

export function evidenceDebt(scenario: Scenario) {
  const present = new Set(scenario.evidence.map(e=>e.signal));
  const signalLabel: Record<Signal,string> = {
    release_change:"deployment provenance", traffic_above_baseline:"traffic baseline", dependency_errors:"dependency error telemetry",
    service_only_impact:"cohort-level service telemetry", multi_client_impact:"cross-client dependency telemetry", rollback_recovery:"rollback recovery timing",
    scale_recovery:"scale-event recovery timing", dependency_recovery:"provider recovery timing", connection_growth:"connection lifecycle metrics",
  };
  return [...new Set(claimDefinitions.flatMap(c=>c.required).filter(s=>!present.has(s)))].map((signal,index)=>({
    id:`DEBT-${scenario.id.slice(0,3).toUpperCase()}-${index+1}`, signal, title:`Capture ${signalLabel[signal]}`,
    reason:`Without ${signalLabel[signal]}, Faultline cannot fully test at least one plausible competing claim.`,
  }));
}
