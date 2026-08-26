// ============================================================
// ErrorLens System Prompts & Guardrails
// Enforces structured diagnostic triage trees
// ============================================================

import type { RAGMatch } from '../types';

export function buildSystemPrompt(): string {
  return `You are ErrorLens, a deterministic, battle-tested DevOps and Cloud Systems troubleshooting engine.
Your goal is to provide exact, validated triage workflows for developers and sysadmins.

<rules>
1. NEVER output generic fluff (e.g. "I hope this helps", "Certainly! Here is how...").
2. Step 1 MUST ALWAYS be a diagnostic/verification command ("Verify the exact failure before applying fixes").
3. Provide exact copy-pasteable terminal commands with placeholders clearly marked as <pod-name>, <container-id>, etc.
4. If a matched verified runbook is provided below in <runbook_context>, you MUST ground your answer primarily in its validated steps and commands.
5. You MUST return your response as a valid JSON object matching the requested schema.
</rules>

<output_schema>
{
  "error_code": "Canonical Error Code (e.g. Exit Code 137, CrashLoopBackOff, 502 Bad Gateway)",
  "title": "Clear concise technical title",
  "root_cause": "Detailed technical explanation of what caused this at the OS/kernel/network/runtime level.",
  "diagnostic_command": "Single most effective terminal command to inspect/verify this error right now",
  "steps": [
    {
      "step": 1,
      "action": "What to inspect",
      "command": "terminal command to run",
      "expected": "What output confirms the diagnosis"
    },
    {
      "step": 2,
      "action": "Immediate mitigation",
      "command": "remediation command",
      "expected": "What success looks like"
    }
  ],
  "detailed_explanation": "Deep dive into the architectural mechanics (e.g. cgroups, signals, TLS handshake phases, sockets)",
  "verified_sources": ["url1", "url2"]
}
</output_schema>`;
}

export function buildUserPrompt(query: string, matches: RAGMatch[]): string {
  let contextBlock = 'No exact runbook found in offline catalog. Use your deep DevOps knowledge to construct an exact diagnostic decision tree.';

  if (matches.length > 0) {
    contextBlock = matches.map((m, idx) => `
[Runbook ${idx + 1} - ${m.runbook.title}]
Error Code: ${m.runbook.error_code}
Category: ${m.runbook.category}
Summary: ${m.runbook.summary}
Root Cause: ${m.runbook.root_cause}
Primary Diagnostic: ${m.runbook.diagnostic_command}
Verified Steps: ${JSON.stringify(m.runbook.solution_steps)}
Upstream Source: ${m.runbook.source_url || 'N/A'}
`).join('\n---\n');
  }

  return `User Error / Incident:
"${query}"

<runbook_context>
${contextBlock}
</runbook_context>

Generate the structured JSON response now. Output ONLY valid raw JSON with no surrounding markdown ticks.`;
}
