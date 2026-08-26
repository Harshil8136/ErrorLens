import { describe, expect, it } from 'vitest';
import {
  extractJson,
  validateContingencies,
  validateDomain,
  validateSeverity,
  validateSources,
  validateSteps,
  validateText,
} from './schema';

describe('validateSteps', () => {
  it('keeps a well-formed step', () => {
    const steps = validateSteps([
      { step: 1, action: 'Check the exit code', command: 'docker inspect x', expected: 'OOMKilled' },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      step: 1,
      action: 'Check the exit code',
      command: 'docker inspect x',
    });
  });

  it('drops steps that are bare strings', () => {
    // Models sometimes return ["do this", "then that"] instead of objects.
    // Passing those through renders empty cards in the UI.
    expect(validateSteps(['do this', 'then that'])).toHaveLength(0);
  });

  it('drops steps with no action text', () => {
    expect(validateSteps([{ step: 1, command: 'ls' }])).toHaveLength(0);
    expect(validateSteps([{ step: 1, action: '   ' }])).toHaveLength(0);
  });

  it('renumbers steps sequentially regardless of what the model claimed', () => {
    const steps = validateSteps([
      { step: 9, action: 'first' },
      { step: 3, action: 'second' },
    ]);
    expect(steps.map((s) => s.step)).toEqual([1, 2]);
  });

  it('omits command and expected when they are blank rather than emitting empty strings', () => {
    const steps = validateSteps([{ step: 1, action: 'look', command: '  ', expected: '' }]);
    expect(steps[0].command).toBeUndefined();
    expect(steps[0].expected).toBeUndefined();
  });

  it('returns an empty array for non-array input', () => {
    expect(validateSteps(null)).toEqual([]);
    expect(validateSteps('steps')).toEqual([]);
    expect(validateSteps({ step: 1 })).toEqual([]);
  });

  it('caps the number of steps', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ step: i, action: `a${i}` }));
    expect(validateSteps(many).length).toBeLessThanOrEqual(12);
  });
});

describe('validateSources', () => {
  it('keeps https urls', () => {
    expect(validateSources(['https://kubernetes.io/docs'])).toEqual(['https://kubernetes.io/docs']);
  });

  it('rejects javascript: urls', () => {
    // These reach the browser as an href. A model emitting one is an XSS.
    expect(validateSources(['javascript:alert(1)'])).toEqual([]);
  });

  it('rejects data: urls and non-strings', () => {
    expect(validateSources(['data:text/html,<script>alert(1)</script>', 42, null])).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(validateSources(['https://a.dev', 'https://a.dev'])).toEqual(['https://a.dev']);
  });
});

describe('validateDomain / validateSeverity', () => {
  it('accepts known values', () => {
    expect(validateDomain('containers_k8s')).toBe('containers_k8s');
    expect(validateSeverity('P1_CRITICAL')).toBe('P1_CRITICAL');
  });

  it('falls back when the model invents a value', () => {
    expect(validateDomain('quantum_networking')).toBe('general_systems');
    expect(validateSeverity('P0_APOCALYPSE')).toBe('P3_MEDIUM');
  });

  it('honours the supplied fallback', () => {
    expect(validateDomain(undefined, 'cloud_edge')).toBe('cloud_edge');
    expect(validateSeverity(null, 'P2_HIGH')).toBe('P2_HIGH');
  });
});

describe('validateContingencies', () => {
  it('requires both condition and action', () => {
    expect(validateContingencies([{ condition: 'if x' }])).toHaveLength(0);
    expect(validateContingencies([{ action: 'do y' }])).toHaveLength(0);
    expect(validateContingencies([{ condition: 'if x', action: 'do y' }])).toHaveLength(1);
  });

  it('keeps an optional command', () => {
    const out = validateContingencies([{ condition: 'if x', action: 'do y', command: 'ls -la' }]);
    expect(out[0].command).toBe('ls -la');
  });
});

describe('validateText', () => {
  it('falls back on empty or non-string input', () => {
    expect(validateText('', 'fallback')).toBe('fallback');
    expect(validateText('   ', 'fallback')).toBe('fallback');
    expect(validateText(123, 'fallback')).toBe('fallback');
  });

  it('truncates past the limit', () => {
    expect(validateText('abcdefghij', 'x', 5)).toHaveLength(5);
  });
});

describe('extractJson', () => {
  it('passes through bare JSON', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('unwraps a ```json fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('unwraps a bare ``` fence', () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('discards prose before and after the object', () => {
    // Workers AI has no JSON mode, so this is the common shape from tier 2.
    expect(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.')).toBe('{"a":1}');
  });
});
