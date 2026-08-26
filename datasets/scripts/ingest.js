#!/usr/bin/env node
// ============================================================
// ErrorLens Runbook Ingestion Utility
// Converts Markdown runbooks in datasets/runbooks/*.md into SQL
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNBOOKS_DIR = path.resolve(__dirname, '../runbooks');

function parseMarkdownRunbook(content) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error('Missing YAML frontmatter (delimited by ---)');
  }

  const [, frontmatterRaw, body] = frontmatterMatch;
  const meta = {};

  frontmatterRaw.split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      let val = rest.join(':').trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        try {
          val = JSON.parse(val.replace(/'/g, '"'));
        } catch {
          val = val.slice(1, -1).split(',').map(s => s.trim());
        }
      }
      meta[key.trim()] = val;
    }
  });

  // Extract sections
  const extractSection = (heading) => {
    const regex = new RegExp(`##\\s+${heading}\\r?\\n([\\s\\S]*?)(?=\\r?\\n##|$)`, 'i');
    const match = body.match(regex);
    return match ? match[1].trim() : '';
  };

  const summary = extractSection('Summary');
  const rootCause = extractSection('Root Cause');
  const diagnostic = extractSection('Diagnostic Command').replace(/```bash\r?\n|```/g, '').trim();
  const triageRaw = extractSection('Triage Steps');

  const steps = [];
  const stepRegex = /(\d+)\.\s+\*\*([^*]+)\*\*:\s*(.*)/g;
  let match;
  while ((match = stepRegex.exec(triageRaw)) !== null) {
    steps.push({
      step: parseInt(match[1], 10),
      action: match[2].trim(),
      command: match[3].trim(),
      expected: 'Verified resolution'
    });
  }

  return {
    slug: meta.slug,
    category: meta.category,
    error_code: meta.error_code,
    title: meta.title,
    summary,
    root_cause: rootCause,
    diagnostic_command: diagnostic,
    solution_steps: JSON.stringify(steps),
    tags: JSON.stringify(Array.isArray(meta.tags) ? meta.tags : []),
    source_url: meta.source_url || ''
  };
}

function run() {
  if (!fs.existsSync(RUNBOOKS_DIR)) {
    console.log('No runbooks directory found.');
    return;
  }

  const files = fs.readdirSync(RUNBOOKS_DIR).filter(f => f.endsWith('.md'));
  console.log(`Found ${files.length} markdown runbooks. Parsing...`);

  const sqlStatements = [];

  for (const file of files) {
    const fullPath = path.join(RUNBOOKS_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    try {
      const data = parseMarkdownRunbook(content);
      const sql = `INSERT OR REPLACE INTO runbooks (slug, category, error_code, title, summary, root_cause, diagnostic_command, solution_steps, tags, source_url) VALUES ('${data.slug}', '${data.category}', '${data.error_code.replace(/'/g, "''")}', '${data.title.replace(/'/g, "''")}', '${data.summary.replace(/'/g, "''")}', '${data.root_cause.replace(/'/g, "''")}', '${data.diagnostic_command.replace(/'/g, "''")}', '${data.solution_steps.replace(/'/g, "''")}', '${data.tags.replace(/'/g, "''")}', '${data.source_url.replace(/'/g, "''")}');`;
      sqlStatements.push(sql);
      console.log(`✓ Parsed: ${file} -> ${data.error_code}`);
    } catch (e) {
      console.error(`✗ Error parsing ${file}:`, e.message);
    }
  }

  const outPath = path.resolve(__dirname, '../generated_seed.sql');
  fs.writeFileSync(outPath, sqlStatements.join('\n\n'), 'utf8');
  console.log(`\nGenerated SQL file at: ${outPath}`);
}

run();
