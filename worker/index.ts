/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const githubHeaders = { "accept": "application/vnd.github+json", "user-agent": "Faultline-Evidence/1.0", "x-github-api-version": "2022-11-28" };

async function githubJson(path: string) {
  const response = await fetch(`https://api.github.com/repos/Sekani-27/Nexara${path}`, { headers: githubHeaders });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`);
  return response.json() as Promise<any>;
}

async function getGitHubEvidence() {
  const [repo, commits, runs, deployments, pulls] = await Promise.all([
    githubJson(""), githubJson("/commits?sha=main&per_page=12"), githubJson("/actions/runs?per_page=12"),
    githubJson("/deployments?per_page=12"), githubJson("/pulls?state=all&per_page=12"),
  ]);
  const commitEvents = commits.map((item:any)=>({ id:item.sha, kind:"commit", title:item.commit.message.split("\n")[0], detail:`${item.sha.slice(0,7)} · ${item.commit.author?.name ?? "Unknown author"}`, at:item.commit.author?.date, url:item.html_url, status:"recorded" }));
  const workflowEvents = runs.workflow_runs.map((item:any)=>({ id:String(item.id), kind:"workflow", title:item.name, detail:`${item.event} · ${item.head_branch ?? "detached"} · ${item.head_sha?.slice(0,7)}`, at:item.updated_at, url:item.html_url, status:item.conclusion ?? item.status }));
  const deploymentEvents = deployments.map((item:any)=>({ id:String(item.id), kind:"deployment", title:`Deployment to ${item.environment}`, detail:`${String(item.ref)} · ${item.sha?.slice(0,7)}`, at:item.created_at, url:`https://github.com/Sekani-27/Nexara/deployments/${item.environment}`, status:"created" }));
  const pullEvents = pulls.map((item:any)=>({ id:String(item.id), kind:"pull_request", title:item.title, detail:`#${item.number} · ${item.user?.login ?? "unknown"}`, at:item.updated_at, url:item.html_url, status:item.merged_at?"merged":item.state }));
  const events = [...workflowEvents,...deploymentEvents,...pullEvents,...commitEvents].filter(e=>e.at).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,24);
  return { repository:{fullName:repo.full_name,url:repo.html_url,branch:repo.default_branch,visibility:repo.visibility,updatedAt:repo.updated_at}, events,
    counts:{commits:commits.length,workflows:runs.workflow_runs.length,deployments:deployments.length,pullRequests:pulls.length}, syncedAt:new Date().toISOString(), syncMode:"live" };
}

const verifiedNexaraSnapshot = {
  repository:{fullName:"Sekani-27/Nexara",url:"https://github.com/Sekani-27/Nexara",branch:"main",visibility:"public",updatedAt:"2026-06-27T21:12:53Z"},
  events:[
    ["524e92522dac50a5318f62a149e614ad16f32636","chore: add ArgoCD annotation to catalog-info","2026-06-27T21:12:53Z"],
    ["bfe76b074bb61fc5cd66e03f7f3dc530bcd41601","chore: add Kubernetes annotations to catalog-info.yaml","2026-06-25T11:30:03Z"],
    ["ac2a7f1d2b334ccc01767ca060392a4da2ccecef","chore: add Backstage catalog-info.yaml","2026-06-24T19:49:11Z"],
    ["f79e82f9ebfb954847739ef6bca7e5c16131b849","Create README.md","2026-06-23T18:01:53Z"],
    ["001061073a7a1a347937e95741b7eaa85ac58eea","ci(release): add Release Please for automated versioning","2026-06-23T16:37:10Z"],
    ["a2b3cd3e82db80f03edc31c68770cf59b4e7f71c","ci(lint): pin black and ruff versions","2026-06-23T12:07:48Z"],
    ["41e353edc5ae80e3fd7c747251f51910b43d5e55","ci(pipeline): replace stub with lint → test → build → deploy pipeline","2026-06-23T12:01:33Z"],
    ["642718bbb783594dcd76adb0c0b20294feb9ce3c","style(lint): formatting, ruff fixes and secrets baseline refresh","2026-06-23T11:23:05Z"],
  ].map(([sha,title,at])=>({id:sha,kind:"commit",title,detail:`${sha.slice(0,7)} · main`,at,url:`https://github.com/Sekani-27/Nexara/commit/${sha}`,status:"recorded"})),
  counts:{commits:8,workflows:0,deployments:0,pullRequests:0}, syncedAt:"2026-08-11T21:30:00Z", syncMode:"verified-snapshot",
};

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/github" && request.method === "GET") {
      try { return Response.json(await getGitHubEvidence(), { headers:{"cache-control":"public, max-age=60, s-maxage=300"} }); }
      catch { return Response.json(verifiedNexaraSnapshot, { headers:{"cache-control":"public, max-age=60, s-maxage=300"} }); }
    }

    if (url.pathname === "/api/state") {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS investigation_state (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        selected_claim_id TEXT NOT NULL,
        debt_status TEXT NOT NULL DEFAULT 'proposed',
        reviewed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`).run();
      if (request.method === "GET") {
        const row = await env.DB.prepare("SELECT * FROM investigation_state WHERE id = ?").bind("portfolio-demo").first();
        return Response.json({ state: row });
      }
      if (request.method === "POST") {
        const body = await request.json() as { scenarioId:string; selectedClaimId:string; debtStatus:string; reviewed:boolean };
        const updatedAt = new Date().toISOString();
        await env.DB.prepare(`INSERT INTO investigation_state (id, scenario_id, selected_claim_id, debt_status, reviewed, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET scenario_id=excluded.scenario_id, selected_claim_id=excluded.selected_claim_id,
          debt_status=excluded.debt_status, reviewed=excluded.reviewed, updated_at=excluded.updated_at`)
          .bind("portfolio-demo", body.scenarioId, body.selectedClaimId, body.debtStatus, body.reviewed ? 1 : 0, updatedAt).run();
        return Response.json({ ok: true, updatedAt });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
