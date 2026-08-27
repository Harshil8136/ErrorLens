import type {
  Env,
  GenerationResult,
  RagMatch,
  Runbook,
  TroubleshootResponse,
  IncidentDomain,
  IncidentSeverity,
  ContingencyOption,
} from '../types';
import { RESPONSE_SCHEMA, buildSystemPrompt, buildUserPrompt } from './prompts';
import {
  extractJson,
  validateSources,
  validateSteps,
  validateText,
  validateContingencies,
  validateDomain,
  validateSeverity,
} from './schema';
import { estimateNeurons } from '../storage/usage';
import { getBudget, recordSpend } from './budget';

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const GEMINI_TIMEOUT_MS = 12_000;
const WORKERS_AI_TIMEOUT_MS = 20_000;

/**
 * Three tiers, tried in order, each one cheaper and less capable than the last:
 *
 *   1. Gemini Flash-Lite on the AI Studio free tier -- best output, but capped
 *      at 15 requests/minute and 1000/day and can be down.
 *   2. Workers AI Llama 3.1 8B -- runs on Cloudflare's own GPUs, costs neurons
 *      from the 10k/day allowance, no schema support so output is looser.
 *   3. The catalog itself -- no model at all, just the matched runbook rendered
 *      into the response shape.
 *
 * Tier 3 is the reason this service has no hard dependency on any LLM being
 * reachable. It is also the only tier whose commands were written by a human
 * and checked against upstream docs, which is why it sets grounded=true.
 */
export async function generate(
  env: Env,
  query: string,
  matches: RagMatch[]
): Promise<GenerationResult> {
  const top = matches[0]?.runbook;
  const system = buildSystemPrompt();
  const user = buildUserPrompt(query, matches);

  // Both paid tiers are gated on today's consumption. Once either ceiling is
  // reached the request silently drops to the next tier -- the user still gets
  // an answer, it just comes from the catalog instead of a model.
  const budget = await getBudget(env);

  if (env.GEMINI_API_KEY && budget.geminiAllowed) {
    const result = await tryGemini(env, query, system, user, top);
    if (result) {
      recordSpend('gemini', 0);
      return result;
    }
  }

  if (env.AI && budget.workersAiAllowed) {
    const result = await tryWorkersAi(env, query, system, user, top);
    if (result) {
      recordSpend('workers-ai', result.neurons);
      return result;
    }
  }

  return {
    response: fromCatalog(query, top),
    model: top ? 'catalog/runbook' : 'catalog/generic',
    neurons: 0,
    provider: 'catalog',
  };
}

async function tryGemini(
  env: Env,
  query: string,
  system: string,
  user: string,
  top: Runbook | undefined
): Promise<GenerationResult | null> {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header auth, not ?key= -- a key in a query string ends up in request
        // logs, referrers and anything else that records URLs.
        'x-goog-api-key': env.GEMINI_API_KEY as string,
      },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      // Read the body: a 400 from a bad schema is undiagnosable without it.
      const detail = await res.text().catch(() => '');
      console.warn(`[ai] Gemini ${res.status}: ${detail.slice(0, 300)}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;

    const response = fromModelJson(raw, query, top);
    return response ? { response, model: `google/${model}`, neurons: 0, provider: 'gemini' } : null;
  } catch (err) {
    console.warn('[ai] Gemini call failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tryWorkersAi(
  env: Env,
  query: string,
  system: string,
  user: string,
  top: Runbook | undefined
): Promise<GenerationResult | null> {
  const model = env.FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  try {
    const run = env.AI!.run(model as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    }) as Promise<{ response?: string }>;

    const result = await withTimeout(run, WORKERS_AI_TIMEOUT_MS, 'workers-ai');
    const raw = result?.response ?? '';
    if (!raw) return null;

    const response = fromModelJson(raw, query, top);
    if (!response) return null;

    return {
      response,
      model: `cloudflare/${model}`,
      neurons: estimateNeurons(DEFAULT_FALLBACK_MODEL, system.length + user.length, raw.length),
      provider: 'workers-ai',
    };
  } catch (err) {
    console.warn('[ai] Workers AI call failed:', err);
    return null;
  }
}

/**
 * Builds a response from model JSON, falling back to the matched runbook field
 * by field. Returns null when the payload is unusable so the caller can drop to
 * the next tier rather than serving a half-empty answer.
 */
function fromModelJson(
  raw: string,
  query: string,
  top: Runbook | undefined
): TroubleshootResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    console.warn('[ai] model returned unparseable JSON:', err);
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const steps = validateSteps(obj.steps);
  const fallbackSteps = top?.solution_steps ?? [];
  const finalSteps = steps.length > 0 ? steps : fallbackSteps;
  const usedCatalogSteps = steps.length === 0 && fallbackSteps.length > 0;

  const domain = validateDomain(obj.domain, inferDomain(query, top));
  const severity = validateSeverity(obj.severity, inferSeverity(query, top));
  const contingencies = validateContingencies(obj.contingencies);
  const finalContingencies =
    contingencies.length > 0 ? contingencies : defaultContingencies(top, domain);

  return {
    query,
    error_code: validateText(obj.error_code, top?.error_code ?? 'Unclassified', 120),
    title: validateText(obj.title, top?.title ?? 'Error Diagnosis', 200),
    domain,
    severity,
    matched_runbook: toMatchedRunbook(top),
    root_cause: validateText(obj.root_cause, top?.root_cause ?? '', 2000),
    diagnostic_command: validateText(obj.diagnostic_command, top?.diagnostic_command ?? '', 800),
    steps: finalSteps,
    contingencies: finalContingencies,
    prevention_sop: validateText(
      obj.prevention_sop,
      'Set up alerting (e.g. Sentry error threshold or uptime monitor) to catch regressions early.',
      1000
    ),
    escalation_ticket: validateText(
      obj.escalation_ticket,
      `[ISSUE SUMMARY] ${validateText(obj.title, 'Error', 100)}\nSeverity: ${severity}\nCategory: ${domain}\nQuery: ${query.slice(0, 120)}`,
      1000
    ),
    detailed_explanation: validateText(obj.detailed_explanation, top?.summary ?? '', 3000),
    verified_sources: dedupeSources(validateSources(obj.verified_sources), top),
    grounded: usedCatalogSteps,
    meta: { from_cache: false, duration_ms: 0, model: '', search_strategy: 'none' },
  };
}

function fromCatalog(query: string, top: Runbook | undefined): TroubleshootResponse {
  const domain = inferDomain(query, top);
  const severity = inferSeverity(query, top);
  const contingencies = defaultContingencies(top, domain);

  if (top && isRelevantToQuery(query, top)) {
    return {
      query,
      error_code: top.error_code,
      title: top.title,
      domain,
      severity,
      matched_runbook: toMatchedRunbook(top),
      root_cause: top.root_cause,
      diagnostic_command: top.diagnostic_command,
      steps: top.solution_steps,
      contingencies,
      prevention_sop: 'Set up alerting in Sentry or your monitoring tool to catch repeat failures.',
      escalation_ticket: `[ERROR REPORT] ${top.title} (${top.error_code})\nRunbook: ${top.slug}`,
      detailed_explanation: top.summary,
      verified_sources: top.source_url ? [top.source_url] : [],
      grounded: true,
      meta: { from_cache: false, duration_ms: 0, model: '', search_strategy: 'none' },
    };
  }

  return buildDomainFallback(query, domain, severity, contingencies);
}

function isRelevantToQuery(query: string, top: Runbook | undefined): boolean {
  if (!top) return false;
  const q = query.toLowerCase();
  const code = top.error_code.toLowerCase().trim();
  const slug = top.slug.toLowerCase().trim();
  if (code && q.includes(code)) return true;
  if (slug && q.includes(slug)) return true;
  return false;
}

function buildDomainFallback(
  query: string,
  domain: IncidentDomain,
  severity: IncidentSeverity,
  contingencies: ContingencyOption[]
): TroubleshootResponse {
  if (domain === 'windows_m365') {
    const codeMatch = query.match(/0x[0-9a-fA-F]{8}/) || query.match(/[A-Z_]{6,}/);
    const code = codeMatch ? codeMatch[0] : 'Windows Error';
    return {
      query,
      error_code: code,
      title: `Windows System Crash / Kernel Stop (${code})`,
      domain,
      severity,
      matched_runbook: null,
      root_cause:
        'A critical Windows kernel subsystem, driver, or hardware component halted execution. The NT kernel triggered a bugcheck to safeguard system integrity.',
      diagnostic_command: 'sfc /scannow && DISM /Online /Cleanup-Image /RestoreHealth',
      steps: [
        {
          step: 1,
          action: 'Check recent crash bugcheck events in Event Viewer',
          command:
            'Get-WinEvent -FilterHashtable @{LogName="System"; Id=41,1001} -MaxEvents 5 -ErrorAction SilentlyContinue | Format-List TimeCreated, Message',
          expected: 'BugcheckCode and failure parameters identifying the crashing driver or service.',
        },
        {
          step: 2,
          action: 'Inspect recent memory dump files in C:\\Windows\\Minidump',
          command:
            'Get-ChildItem -Path "C:\\Windows\\Minidump" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, Length, LastWriteTime',
          expected: 'Presence of minidump (.dmp) files generated at the time of crash.',
        },
        {
          step: 3,
          action: 'Scan and repair corrupted Windows system files',
          command: 'sfc /scannow',
          expected: '"Windows Resource Protection did not find any integrity violations" or successfully repaired files.',
        },
        {
          step: 4,
          action: 'Repair the Windows Component Store image using DISM',
          command: 'DISM.exe /Online /Cleanup-image /Restorehealth',
          expected: '"The restore operation completed successfully."',
        },
      ],
      contingencies,
      prevention_sop:
        'Enable automatic minidump generation in Advanced System Settings and run Windows Memory Diagnostic (mdsched.exe).',
      escalation_ticket: `[WINDOWS CRASH REPORT]\nError: ${code}\nQuery: ${query}\nSeverity: ${severity}`,
      detailed_explanation:
        'Windows Stop errors (BSOD) occur in kernel mode when code running in Ring 0 violates memory access rules or a critical system service exits. Use WinDbg or BlueScreenView to inspect the crash stack trace.',
      verified_sources: ['https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/bug-check-code-reference2'],
      grounded: false,
      meta: { from_cache: false, duration_ms: 0, model: '', search_strategy: 'none' },
    };
  }

  return {
    query,
    error_code: 'Unclassified',
    title: 'Diagnostic Guide',
    domain,
    severity,
    matched_runbook: null,
    root_cause:
      'Diagnostic inspection steps provided to isolate the root cause.',
    diagnostic_command: 'journalctl -xe --no-pager | tail -n 50',
    steps: [
      {
        step: 1,
        action: 'Check recent system errors and signals',
        command: 'journalctl -xe --no-pager | tail -n 50',
        expected: 'Recent service failures, OOM kills or stack traces.',
      },
      {
        step: 2,
        action: 'Inspect status of failing service or unit',
        command: 'systemctl status <service-name>',
        expected: 'Process status, active PID, and exit codes.',
      },
    ],
    contingencies,
    prevention_sop: 'Check service logs and system health to diagnose the failure.',
    escalation_ticket: `[ERROR REPORT] Unclassified Error\nQuery: ${query.slice(0, 100)}`,
    detailed_explanation:
      'For best results, include the exact error code, exception string, or terminal output in your query.',
    verified_sources: [],
    grounded: false,
    meta: { from_cache: false, duration_ms: 0, model: '', search_strategy: 'none' },
  };
}

function inferDomain(query: string, top: Runbook | undefined): IncidentDomain {
  const text = (
    query +
    ' ' +
    (top?.category || '') +
    ' ' +
    (top?.tags?.join(' ') || '')
  ).toLowerCase();
  if (/cloudflare|worker|r2|s3|aws|azure|gcp|edge|lambda|serverless/.test(text))
    return 'cloud_edge';
  if (
    /dns|servfail|nxdomain|ip|tcp|udp|vpn|wireguard|lan|wifi|zero\s*trust|cfzt|route|cisco/.test(
      text
    )
  )
    return 'networking_dns';
  if (/docker|container|k8s|kubernetes|pod|helm|kubelet|imagepull/.test(text))
    return 'containers_k8s';
  if (/postgres|psql|supabase|mysql|sql|sqlite|deadlock|database|connection/.test(text))
    return 'database_sql';
  if (
    /windows|active\s*directory|kerberos|ad\s|m365|office|powershell|bsod|0x[0-9a-f]{8}/.test(text)
  )
    return 'windows_m365';
  if (/linux|systemd|journalctl|cgroup|inode|enospc|bash|ssh|dmesg/.test(text))
    return 'linux_sysadmin';
  if (/sentry|posthog|betterstack|metric|alert|webhook|grafana|incident/.test(text))
    return 'observability_app';
  return 'general_systems';
}

function inferSeverity(query: string, top: Runbook | undefined): IncidentSeverity {
  const text = (query + ' ' + (top?.title || '') + ' ' + (top?.error_code || '')).toLowerCase();
  if (/outage|crash|down|panic|fatal|oom|kill|137|500|502|503|522|corrupt|data\s*loss/.test(text))
    return 'P1_CRITICAL';
  if (/fail|error|timeout|denied|403|unsupported|degraded|slow|block/.test(text)) return 'P2_HIGH';
  if (/warn|retry|leak|deprecated/.test(text)) return 'P3_MEDIUM';
  return 'P4_LOW';
}

/**
 * Fallback "still not working?" branches, used when the model returns none.
 *
 * Keyed by domain rather than by runbook slug: a per-slug table is really data
 * pretending to be code, and it stops scaling the moment the corpus grows past
 * a handful of entries. Runbook-specific contingencies belong in the runbook.
 */
const DOMAIN_CONTINGENCIES: Record<IncidentDomain, ContingencyOption[]> = {
  containers_k8s: [
    {
      condition: 'If the container restarts before writing any logs',
      action:
        'Attach an ephemeral debug container so you can inspect the filesystem and network from inside the pod',
      command: 'kubectl debug pod/<pod-name> -it --image=busybox --target=<container-name>',
    },
    {
      condition: 'If the process is killed during startup rather than crashing',
      action:
        'Check whether the liveness probe fires before the app finishes booting; a startupProbe is usually the fix',
      command: 'kubectl describe pod <pod-name> | grep -A 5 Liveness',
    },
  ],
  cloud_edge: [
    {
      condition: 'If the error is intermittent rather than constant',
      action:
        'Tail live logs while reproducing so you can see the failing invocation rather than an aggregate',
      command: 'npx wrangler tail --status error',
    },
    {
      condition: 'If the request never reaches your code',
      action:
        'Check whether the edge is rejecting it before dispatch by inspecting the response headers',
      command: 'curl -sSI https://<your-domain>/<path>',
    },
  ],
  networking_dns: [
    {
      condition: 'If the name resolves locally but not from the affected host',
      action: 'Query the authoritative nameserver directly to rule out a stale resolver cache',
      command: 'dig +trace <domain> A',
    },
    {
      condition: 'If resolution succeeds but the connection still fails',
      action: 'Confirm the port is actually reachable and not filtered upstream',
      command: 'nc -vz <host> <port>',
    },
  ],
  linux_sysadmin: [
    {
      condition: 'If the command reports permission denied',
      action: 'Re-run with elevated privileges, or check the effective user the service runs as',
      command: 'id && systemctl show <service-name> -p User',
    },
    {
      condition: 'If the symptom persists after the fix',
      action: 'Look for the kernel-level event behind it rather than the userspace symptom',
      command: 'journalctl -xe -n 50 --no-pager && dmesg -T | tail -n 30',
    },
  ],
  windows_m365: [
    {
      condition: 'If the GUI gives no detail',
      action: 'Pull the underlying event records, which carry the actual status code',
      command: 'Get-WinEvent -LogName System -MaxEvents 30 | Format-List TimeCreated, Id, Message',
    },
    {
      condition: 'If the failure looks permission-related',
      action: 'Confirm the account can actually reach the directory service before changing policy',
      command: 'nltest /dsgetdc:<domain>',
    },
  ],
  database_sql: [
    {
      condition: 'If connections are refused rather than slow',
      action: 'Check how many connections are open against the configured maximum',
      command:
        'psql -c "SELECT count(*), (SELECT setting FROM pg_settings WHERE name=\'max_connections\') FROM pg_stat_activity;"',
    },
    {
      condition: 'If queries hang instead of erroring',
      action: 'Look for a blocking lock before assuming the query itself is slow',
      command:
        'psql -c "SELECT pid, state, wait_event_type, query FROM pg_stat_activity WHERE state <> \'idle\';"',
    },
  ],
  observability_app: [
    {
      condition: 'If the alert fired but you cannot reproduce it',
      action:
        'Find the specific event rather than the aggregate, and check whether it is still occurring',
      command: 'curl -s "https://<your-host>/api/health" -w "\n%{http_code}\n"',
    },
    {
      condition: 'If the webhook never arrived',
      action: 'Confirm the sender got a 2xx, since most providers silently drop after retries',
      command:
        'curl -sS -X POST https://<your-endpoint> -d "{}" -H "Content-Type: application/json" -i',
    },
  ],
  general_systems: [
    {
      condition: 'If the diagnostic command is missing or returns permission denied',
      action:
        'Check the tool is installed and that you are running as a user allowed to inspect the process',
      command: 'command -v <tool> || echo "not installed"',
    },
    {
      condition: 'If the symptom persists after remediation',
      action: 'Widen the search to recent system-level events around the failure time',
      command: 'journalctl -xe -n 50 --no-pager',
    },
  ],
};

function defaultContingencies(
  _top: Runbook | undefined,
  domain: IncidentDomain
): ContingencyOption[] {
  return DOMAIN_CONTINGENCIES[domain] ?? DOMAIN_CONTINGENCIES.general_systems;
}

function toMatchedRunbook(top: Runbook | undefined): TroubleshootResponse['matched_runbook'] {
  if (!top) return null;
  return {
    id: top.id,
    slug: top.slug,
    title: top.title,
    error_code: top.error_code,
    category: top.category,
    source_url: top.source_url,
    verified_at: top.verified_at,
  };
}

function dedupeSources(fromModel: string[], top: Runbook | undefined): string[] {
  const all = [...fromModel];
  if (top?.source_url && !all.includes(top.source_url)) all.unshift(top.source_url);
  return all.slice(0, 6);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}
