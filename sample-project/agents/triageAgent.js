/**
 * triageAgent.js — Document-Understanding Triage Agent for TaskFlow API
 *
 * Pipeline
 * ────────
 * 1. INGEST   — reads bug report (stdin/arg), logs/error.log, README.md, and
 *               every .js file under src/  into named document slots.
 * 2. PARSE    — splits each document into logical segments (log blocks,
 *               markdown sections, source functions).
 * 3. CLASSIFY — runs rule-based classifiers that emit one IncidentMatch per
 *               INC-442 / INC-443 / INC-444 signal found anywhere in the corpus.
 * 4. EXTRACT  — for each match pulls out: incident ID, category, affected file,
 *               line numbers, error type, request context, stack frames, fix hint.
 * 5. REPORT   — merges per-document evidence, deduplicates, and writes a
 *               structured JSON report to stdout (and optionally a file).
 *
 * Usage
 * ─────
 *   node agents/triageAgent.js [bugReportText] [--out=report.json]
 *
 *   bugReportText  Optional free-text bug report passed as the first CLI arg.
 *                  If omitted the agent still processes the three known documents.
 *   --out=<path>   Write JSON report to this file in addition to stdout.
 *
 * No external dependencies — uses only Node.js built-ins.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths (resolved relative to this file so the agent is portable)
// ---------------------------------------------------------------------------
const ROOT      = path.resolve(__dirname, '..');
const LOG_FILE  = path.join(ROOT, 'logs', 'error.log');
const README    = path.join(ROOT, 'README.md');
const SRC_DIR   = path.join(ROOT, 'src');

// ---------------------------------------------------------------------------
// Incident catalogue — static knowledge base
// ---------------------------------------------------------------------------
const INCIDENTS = {
  'INC-442': {
    id:       'INC-442',
    category: 'pagination-data-leak',
    title:    'Pagination off-by-one + missing bounds check',
    severity: 'HIGH',
    affectedFile: 'src/utils.js',
    affectedFunction: 'paginate()',
    affectedLine: 19,
    errorClass: 'TypeError',
    cwe:      'CWE-193 (Off-by-one Error)',
    fix:      'Change `const start = page * limit` to `const start = (page - 1) * limit` and clamp end with Math.min(start + limit, data.length)',
  },
  'INC-443': {
    id:       'INC-443',
    category: 'jwt-security-bypass',
    title:    'JWT decoded without signature verification + 24 h grace period',
    severity: 'CRITICAL',
    affectedFile: 'src/auth.js',
    affectedFunction: 'authenticate()',
    affectedLine: 44,
    errorClass: 'JsonWebTokenError / TokenExpiredError',
    cwe:      'CWE-347 (Improper Verification of Cryptographic Signature)',
    fix:      'Replace jwt.decode(token) with jwt.verify(token, SECRET) and remove GRACE_PERIOD_SECONDS',
  },
  'INC-444': {
    id:       'INC-444',
    category: 'timezone-date-mismatch',
    title:    'parseDueDate ignores timezone param — PST off-by-one day',
    severity: 'MEDIUM',
    affectedFile: 'src/tasks.js',
    affectedFunction: 'parseDueDate()',
    affectedLine: 92,
    errorClass: 'RangeError (semantic)',
    cwe:      'CWE-682 (Incorrect Calculation)',
    fix:      'Use date-fns-tz fromZonedTime(`${dateString}T00:00:00`, userTimezone) to convert to UTC before persisting',
  },
};

// ---------------------------------------------------------------------------
// Section 1 — INGEST
// ---------------------------------------------------------------------------

/**
 * Reads a file to string; returns null if missing (non-fatal).
 * @param {string} filePath
 * @returns {string|null}
 */
function readDoc(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Loads all .js files from src/ into a map of { relPath → content }.
 * @returns {Map<string, string>}
 */
function loadSourceFiles() {
  const map = new Map();
  try {
    for (const name of fs.readdirSync(SRC_DIR)) {
      if (!name.endsWith('.js')) continue;
      const full = path.join(SRC_DIR, name);
      const content = readDoc(full);
      if (content !== null) map.set(`src/${name}`, content);
    }
  } catch { /* src dir missing */ }
  return map;
}

// ---------------------------------------------------------------------------
// Section 2 — PARSE helpers
// ---------------------------------------------------------------------------

/**
 * Splits the error.log into discrete incident blocks separated by `---`.
 * Each block retains its raw text for further extraction.
 * @param {string} text
 * @returns {Array<{ raw: string, timestamp: string|null, incidentId: string|null }>}
 */
function parseLogBlocks(text) {
  if (!text) return [];
  return text
    .split(/^---\s*$/m)
    .map(raw => raw.trim())
    .filter(Boolean)
    .map(raw => ({
      raw,
      timestamp:  (raw.match(/^\[([^\]]+)\]/) || [])[1] ?? null,
      incidentId: (raw.match(/INC-(\d+)/) || [])[0] ?? null,
    }));
}

/**
 * Extracts the call stack frames from a log block.
 * Frames are lines beginning with `    at ` (4-space indent).
 * @param {string} blockText
 * @returns {Array<{ raw: string, fn: string|null, file: string|null, line: number|null, col: number|null }>}
 */
function extractStackFrames(blockText) {
  return blockText
    .split('\n')
    .filter(l => /^\s{4}at /.test(l))
    .map(l => {
      const raw = l.trim();
      // "at fnName (/path/file.js:line:col)" or "at /path/file.js:line:col"
      const match = raw.match(/^at\s+(?:([^\s(]+)\s+)?\(?(\/[^)]+)\)?$/);
      if (!match) return { raw, fn: null, file: null, line: null, col: null };
      const [, fn, loc] = match;
      const locMatch = loc.match(/^(.+):(\d+):(\d+)$/);
      if (!locMatch) return { raw, fn: fn ?? null, file: loc, line: null, col: null };
      return {
        raw,
        fn:   fn ?? null,
        file: locMatch[1],
        line: parseInt(locMatch[2], 10),
        col:  parseInt(locMatch[3], 10),
      };
    });
}

/**
 * Extracts Request/Response/Context/See metadata lines from a log block.
 * @param {string} blockText
 * @returns {{ request: string|null, response: string|null, context: string[], see: string[] }}
 */
function extractLogContext(blockText) {
  const lines   = blockText.split('\n');
  const request  = lines.find(l => /^Request:/.test(l))?.replace(/^Request:\s*/, '').trim() ?? null;
  const response = lines.find(l => /^Response:/.test(l))?.replace(/^Response:\s*/, '').trim() ?? null;
  const context  = lines.filter(l => /^\s+(paginate|jwt|GRACE|new Date|start=|token\.exp|userTimezone)/.test(l)).map(l => l.trim());
  const see      = lines.filter(l => /^See:|^\s+src\//.test(l)).map(l => l.trim()).filter(Boolean);
  return { request, response, context, see };
}

/**
 * Parses a README.md into a map of section heading → body text.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseReadmeSections(text) {
  if (!text) return new Map();
  const map = new Map();
  const sectionRe = /^###\s+(.+)$/gm;
  let match;
  const positions = [];
  while ((match = sectionRe.exec(text)) !== null) {
    positions.push({ heading: match[1].trim(), start: match.index + match[0].length });
  }
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    map.set(positions[i].heading, text.slice(positions[i].start, end).trim());
  }
  return map;
}

/**
 * Extracts named JS functions from source text as { name, startLine, body }.
 * Handles `function name(` and `const name =` style declarations.
 * @param {string} src
 * @returns {Array<{ name: string, startLine: number, body: string }>}
 */
function parseSourceFunctions(src) {
  if (!src) return [];
  const lines = src.split('\n');
  const fns   = [];
  const fnStart = /^(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnStart);
    if (!m) continue;
    const name = m[1] ?? m[2];
    // gather body until matching closing brace depth returns to 0
    let depth = 0, j = i, body = '';
    for (; j < lines.length; j++) {
      const line = lines[j];
      for (const ch of line) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      body += line + '\n';
      if (depth === 0 && j > i) break;
    }
    fns.push({ name, startLine: i + 1, body: body.trim() });
  }
  return fns;
}

// ---------------------------------------------------------------------------
// Section 3 — CLASSIFY
// Each classifier returns an array of signal objects:
//   { incidentId, source, evidence, confidence }
// ---------------------------------------------------------------------------

const CLASSIFIERS = [

  // ── INC-442 ───────────────────────────────────────────────────────────────
  {
    incidentId: 'INC-442',
    /** @param {ClassifyCtx} ctx */
    run(ctx) {
      const signals = [];

      // Signal A: buggy line in utils.js source
      const utils = ctx.source.get('src/utils.js') ?? '';
      if (/const start\s*=\s*page\s*\*\s*limit/.test(utils)) {
        signals.push({
          source: 'src/utils.js',
          evidence: 'Line matches `const start = page * limit` — missing `(page - 1)` factor',
          confidence: 1.0,
          line: (() => {
            const idx = utils.split('\n').findIndex(l => /const start\s*=\s*page\s*\*\s*limit/.test(l));
            return idx >= 0 ? idx + 1 : null;
          })(),
        });
      }

      // Signal B: no Math.min / bounds clamp on end
      if (!/Math\.min/.test(utils) && /const end\s*=\s*start\s*\+\s*limit/.test(utils)) {
        signals.push({
          source: 'src/utils.js',
          evidence: 'Missing Math.min bounds clamp — end may exceed data.length',
          confidence: 0.95,
        });
      }

      // Signal C: error.log block tagged INC-442
      for (const block of ctx.logBlocks) {
        if (block.incidentId === 'INC-442') {
          signals.push({
            source: 'logs/error.log',
            evidence: `Log entry at ${block.timestamp}: ${(block.raw.split('\n')[1] ?? '').trim()}`,
            confidence: 1.0,
            stackFrames: extractStackFrames(block.raw),
            logContext:  extractLogContext(block.raw),
          });
        }
      }

      // Signal D: README section mentions INC-442
      for (const [heading, body] of ctx.readmeSections) {
        if (/INC-442/.test(heading) || /INC-442/.test(body)) {
          const fixMatch = body.match(/```js\n([\s\S]+?)```/);
          signals.push({
            source: 'README.md',
            evidence: `README section "${heading}" documents this incident`,
            confidence: 0.9,
            readmeFix: fixMatch ? fixMatch[1].trim() : null,
          });
        }
      }

      // Signal E: free-text bug report
      if (ctx.bugReport && /pagina|off.by.one|page\s*\*\s*limit|INC-442/i.test(ctx.bugReport)) {
        signals.push({
          source: 'bug-report',
          evidence: 'Bug report text references pagination / off-by-one / INC-442',
          confidence: 0.85,
        });
      }

      return signals;
    },
  },

  // ── INC-443 ───────────────────────────────────────────────────────────────
  {
    incidentId: 'INC-443',
    run(ctx) {
      const signals = [];

      const auth = ctx.source.get('src/auth.js') ?? '';

      // Signal A: jwt.decode instead of jwt.verify
      if (/jwt\.decode\(token\)/.test(auth)) {
        const lineNum = auth.split('\n').findIndex(l => /jwt\.decode\(token\)/.test(l));
        signals.push({
          source: 'src/auth.js',
          evidence: '`jwt.decode(token)` found — signature is NOT verified',
          confidence: 1.0,
          line: lineNum >= 0 ? lineNum + 1 : null,
        });
      }

      // Signal B: GRACE_PERIOD_SECONDS non-zero
      const graceMatch = auth.match(/GRACE_PERIOD_SECONDS\s*=\s*(.+)/);
      if (graceMatch) {
        const expr = graceMatch[1].trim().replace(/\/\/.*/, '').replace(/;$/, '').trim();
        // evaluate only safe numeric expressions
        const safe = /^[\d\s\*\+\-\/()]+$/.test(expr);
        const value = safe ? Function(`'use strict'; return (${expr})`)() : null; // eslint-disable-line no-new-func
        if (value !== 0) {
          signals.push({
            source: 'src/auth.js',
            evidence: `GRACE_PERIOD_SECONDS = ${expr} (evaluates to ${value ?? '?'} s) — should be 0`,
            confidence: 1.0,
            gracePeriodSeconds: value,
          });
        }
      }

      // Signal C: error.log blocks tagged INC-443
      for (const block of ctx.logBlocks) {
        if (block.incidentId === 'INC-443') {
          signals.push({
            source: 'logs/error.log',
            evidence: `Log entry at ${block.timestamp}: ${(block.raw.split('\n')[1] ?? '').trim()}`,
            confidence: 1.0,
            stackFrames: extractStackFrames(block.raw),
            logContext:  extractLogContext(block.raw),
          });
        }
      }

      // Signal D: README
      for (const [heading, body] of ctx.readmeSections) {
        if (/INC-443/.test(heading) || /INC-443/.test(body)) {
          const fixMatch = body.match(/```js\n([\s\S]+?)```/);
          signals.push({
            source: 'README.md',
            evidence: `README section "${heading}" documents this incident`,
            confidence: 0.9,
            readmeFix: fixMatch ? fixMatch[1].trim() : null,
          });
        }
      }

      // Signal E: bug report
      if (ctx.bugReport && /jwt|token|expir|grace|INC-443|signature|decode/i.test(ctx.bugReport)) {
        signals.push({
          source: 'bug-report',
          evidence: 'Bug report references JWT / token / expiry / decode / INC-443',
          confidence: 0.85,
        });
      }

      return signals;
    },
  },

  // ── INC-444 ───────────────────────────────────────────────────────────────
  {
    incidentId: 'INC-444',
    run(ctx) {
      const signals = [];

      const tasks = ctx.source.get('src/tasks.js') ?? '';

      // Signal A: parseDueDate ignores its second argument
      const fns = parseSourceFunctions(tasks);
      const parseFn = fns.find(f => f.name === 'parseDueDate');
      if (parseFn) {
        const usesTimezone = /userTimezone/.test(
          parseFn.body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
        );
        if (!usesTimezone) {
          signals.push({
            source: 'src/tasks.js',
            evidence: `parseDueDate() (line ${parseFn.startLine}) accepts userTimezone but never references it in executable code`,
            confidence: 1.0,
            line: parseFn.startLine,
          });
        }
      }

      // Signal B: bare new Date(dateString) without tz conversion
      if (/new Date\(dateString\)/.test(tasks)) {
        const lineNum = tasks.split('\n').findIndex(l => /new Date\(dateString\)/.test(l));
        signals.push({
          source: 'src/tasks.js',
          evidence: '`new Date(dateString)` parses as UTC midnight — ignores caller timezone',
          confidence: 0.95,
          line: lineNum >= 0 ? lineNum + 1 : null,
        });
      }

      // Signal C: error.log block tagged INC-444
      for (const block of ctx.logBlocks) {
        if (block.incidentId === 'INC-444') {
          signals.push({
            source: 'logs/error.log',
            evidence: `Log entry at ${block.timestamp}: ${(block.raw.split('\n')[1] ?? '').trim()}`,
            confidence: 1.0,
            stackFrames: extractStackFrames(block.raw),
            logContext:  extractLogContext(block.raw),
          });
        }
      }

      // Signal D: README
      for (const [heading, body] of ctx.readmeSections) {
        if (/INC-444/.test(heading) || /INC-444/.test(body)) {
          const fixMatch = body.match(/```js\n([\s\S]+?)```/);
          signals.push({
            source: 'README.md',
            evidence: `README section "${heading}" documents this incident`,
            confidence: 0.9,
            readmeFix: fixMatch ? fixMatch[1].trim() : null,
          });
        }
      }

      // Signal E: bug report
      if (ctx.bugReport && /timezone|PST|due.?date|off.by|INC-444|parseDueDate/i.test(ctx.bugReport)) {
        signals.push({
          source: 'bug-report',
          evidence: 'Bug report references timezone / PST / dueDate / parseDueDate / INC-444',
          confidence: 0.85,
        });
      }

      return signals;
    },
  },
];

// ---------------------------------------------------------------------------
// Section 4 — EXTRACT  (build IncidentMatch from classifier signals)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} IncidentMatch
 * @property {string}   incidentId
 * @property {string}   category
 * @property {string}   title
 * @property {string}   severity
 * @property {string}   affectedFile
 * @property {string}   affectedFunction
 * @property {number}   affectedLine
 * @property {string}   errorClass
 * @property {string}   cwe
 * @property {string}   fix
 * @property {number}   confidence          - max across all signals (0–1)
 * @property {string[]} sources             - deduplicated list of source documents
 * @property {Array}    stackTraces         - all extracted stack frames
 * @property {Array}    logContextEntries   - Request/Response/Context lines from log
 * @property {string[]} evidenceSummary     - one line per signal
 * @property {string|null} readmeFix        - fix snippet from README if found
 */

/**
 * Merges signals from one classifier into a single IncidentMatch.
 * @param {string} incidentId
 * @param {Array}  signals
 * @returns {IncidentMatch|null}
 */
function buildMatch(incidentId, signals) {
  if (!signals.length) return null;

  const base = INCIDENTS[incidentId];
  const maxConf = Math.max(...signals.map(s => s.confidence));

  const stackTraces      = [];
  const logContextEntries = [];
  const sources          = new Set();
  const evidenceSummary  = [];
  let   readmeFix        = null;
  let   detectedLine     = base.affectedLine;

  for (const sig of signals) {
    sources.add(sig.source);
    evidenceSummary.push(`[${sig.source}] (conf=${sig.confidence.toFixed(2)}) ${sig.evidence}`);
    if (sig.stackFrames?.length)  stackTraces.push(...sig.stackFrames);
    if (sig.logContext)           logContextEntries.push(sig.logContext);
    if (sig.readmeFix)            readmeFix = sig.readmeFix;
    if (sig.line != null)         detectedLine = sig.line;
  }

  return {
    ...base,
    affectedLine:      detectedLine,
    confidence:        maxConf,
    sources:           [...sources],
    stackTraces:       dedupeFrames(stackTraces),
    logContextEntries,
    evidenceSummary,
    readmeFix,
  };
}

/**
 * Removes duplicate stack frames (same raw text).
 * @param {Array} frames
 * @returns {Array}
 */
function dedupeFrames(frames) {
  const seen = new Set();
  return frames.filter(f => {
    if (seen.has(f.raw)) return false;
    seen.add(f.raw);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Section 5 — REPORT
// ---------------------------------------------------------------------------

/**
 * Builds the final structured triage report.
 * @param {Array<IncidentMatch>} matches
 * @param {Object} meta
 * @returns {Object}
 */
function buildReport(matches, meta) {
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...matches].sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
  );

  return {
    reportVersion: '1.0.0',
    agent:         'triageAgent',
    generatedAt:   new Date().toISOString(),
    project:       'TaskFlow API',
    documentsIngested: meta.documentsIngested,
    totalIncidentsClassified: sorted.length,
    incidents: sorted,
    summary: sorted.map(m =>
      `${m.id} [${m.severity}] ${m.title} — ${m.affectedFile}:${m.affectedLine} (conf=${m.confidence.toFixed(2)})`
    ),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function run() {
  // ── parse CLI args ─────────────────────────────────────────────────────
  const args      = process.argv.slice(2);
  const bugReport = args.find(a => !a.startsWith('--')) ?? null;
  const outArg    = args.find(a => a.startsWith('--out='));
  const outFile   = outArg ? outArg.slice(6) : null;

  // ── ingest ─────────────────────────────────────────────────────────────
  const logText     = readDoc(LOG_FILE);
  const readmeText  = readDoc(README);
  const sourceFiles = loadSourceFiles();

  const documentsIngested = [
    logText    ? 'logs/error.log' : null,
    readmeText ? 'README.md'      : null,
    ...sourceFiles.keys(),
    bugReport  ? 'bug-report (cli-arg)' : null,
  ].filter(Boolean);

  // ── parse ──────────────────────────────────────────────────────────────
  /** @type {ClassifyCtx} */
  const ctx = {
    bugReport,
    logBlocks:      parseLogBlocks(logText ?? ''),
    readmeSections: parseReadmeSections(readmeText ?? ''),
    source:         sourceFiles,
  };

  // ── classify + extract ─────────────────────────────────────────────────
  const matches = [];
  for (const classifier of CLASSIFIERS) {
    const signals = classifier.run(ctx);
    const match   = buildMatch(classifier.incidentId, signals);
    if (match) matches.push(match);
  }

  // ── report ─────────────────────────────────────────────────────────────
  const report = buildReport(matches, { documentsIngested });
  const json   = JSON.stringify(report, null, 2);

  process.stdout.write(json + '\n');

  if (outFile) {
    const outPath = path.resolve(process.cwd(), outFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    process.stderr.write(`[triageAgent] Report written to ${outPath}\n`);
  }
}

run();
