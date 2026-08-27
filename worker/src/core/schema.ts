import type { TriageStep, ContingencyOption, IncidentDomain, IncidentSeverity } from '../types';
import { isSafeHttpUrl } from './security';

/**
 * Runtime validation of model output.
 *
 * The response schema sent to Gemini makes malformed output unlikely, but
 * "unlikely" is not a guarantee, and the Workers AI fallback has no schema
 * support at all. Everything below is rendered in a browser and some of it is
 * meant to be pasted into a shell, so nothing reaches the client unchecked.
 */

const MAX_STEPS = 12;
const MAX_CONTINGENCIES = 5;
const MAX_ACTION_CHARS = 400;
const MAX_COMMAND_CHARS = 800;
const MAX_SOURCES = 6;

export function validateSteps(value: unknown): TriageStep[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .filter((s) => typeof s.action === 'string' && s.action.trim().length > 0)
    .slice(0, MAX_STEPS)
    .map((s, index) => {
      const step: TriageStep = {
        step: index + 1,
        action: truncate(String(s.action).trim(), MAX_ACTION_CHARS),
      };
      if (typeof s.command === 'string' && s.command.trim()) {
        step.command = truncate(s.command.trim(), MAX_COMMAND_CHARS);
      }
      if (typeof s.expected === 'string' && s.expected.trim()) {
        step.expected = truncate(s.expected.trim(), MAX_ACTION_CHARS);
      }
      return step;
    });
}

export function validateContingencies(value: unknown): ContingencyOption[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .filter(
      (c) =>
        typeof c.condition === 'string' &&
        c.condition.trim().length > 0 &&
        typeof c.action === 'string' &&
        c.action.trim().length > 0
    )
    .slice(0, MAX_CONTINGENCIES)
    .map((c) => {
      const opt: ContingencyOption = {
        condition: truncate(String(c.condition).trim(), MAX_ACTION_CHARS),
        action: truncate(String(c.action).trim(), MAX_ACTION_CHARS),
      };
      if (typeof c.command === 'string' && c.command.trim()) {
        opt.command = truncate(c.command.trim(), MAX_COMMAND_CHARS);
      }
      return opt;
    });
}

const VALID_DOMAINS: IncidentDomain[] = [
  'cloud_edge',
  'networking_dns',
  'linux_sysadmin',
  'windows_m365',
  'containers_k8s',
  'database_sql',
  'observability_app',
  'general_systems',
];

export function validateDomain(
  value: unknown,
  fallback: IncidentDomain = 'general_systems'
): IncidentDomain {
  if (typeof value === 'string' && (VALID_DOMAINS as string[]).includes(value)) {
    return value as IncidentDomain;
  }
  return fallback;
}

const VALID_SEVERITIES: IncidentSeverity[] = ['P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW'];

export function validateSeverity(
  value: unknown,
  fallback: IncidentSeverity = 'P3_MEDIUM'
): IncidentSeverity {
  if (typeof value === 'string' && (VALID_SEVERITIES as string[]).includes(value)) {
    return value as IncidentSeverity;
  }
  return fallback;
}

export function validateSources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isSafeHttpUrl))].slice(0, MAX_SOURCES);
}

export function validateText(value: unknown, fallback: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return truncate(value.trim(), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Strips markdown fences a model may wrap JSON in despite being asked not to.
 * Handles ```json, bare ``` and stray leading prose before the first brace.
 */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return body;
  return body.slice(start, end + 1);
}
