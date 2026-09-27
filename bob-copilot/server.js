'use strict';
/**
 * server.js — Bob Maintenance Co-Pilot API server
 *
 * POST /api/analyze    — runs the 3-phase orchestrator, streams SSE events
 * GET  /api/examples   — returns 3 canned bug report examples
 * GET  /*              — serves public/ static files
 *
 * SSE event stream shape (text/event-stream):
 *   event: phase_start   data: { phase, name, strategy, agents[] }
 *   event: phase_done    data: { phase, name, durationMs, result? }
 *   event: agent_status  data: { agentId, state, durationMs? }
 *   event: complete      data: { ...full result object }
 *   event: error         data: { message }
 */

const express          = require('express');
const cors             = require('cors');
const path             = require('path');
const { orchestrateFix } = require('./orchestrator');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Examples ────────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    id: 'INC-442',
    title: 'Pagination returns empty + data leak',
    report: `User report: GET /tasks?page=1&limit=2 returns [] but should return 2 tasks. Also when I quickly paginate to page=2 I saw tasks from another user (user_456)! This is a data leak.

Logs:
[ERROR] at paginate (src/utils.js:9)
GET /tasks?page=1&limit=2 returned [] expected 2 items
Security concern - INC-442`,
  },
  {
    id: 'INC-443',
    title: 'Expired JWT still works — security bypass',
    report: `Security audit: Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... expired 24h ago but still gets 200 OK on /tasks.

We checked auth.js — it's using jwt.decode not verify! And there's a 24h grace period block. This is critical - INC-443

Stack:
at authMiddleware (src/auth.js:10)
at Layer.handle (node_modules/express/lib/router/layer.js:95)`,
  },
  {
    id: 'INC-444',
    title: 'Due dates off by 1 day for PST users',
    report: `User in PST (America/Los_Angeles) reports: I created a task with dueDate 2024-03-20, but it shows as 2024-03-21.

I checked — parseDueDate in tasks.js ignores the timezone param! It just does new Date(dateString).
For PST users, midnight PST is 07:00 UTC next day, so date shifts. INC-444`,
  },
];

app.get('/api/examples', (_req, res) => res.json(EXAMPLES));

// ── Analyze — SSE streaming ──────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { bugReport } = req.body;
  if (!bugReport) return res.status(400).json({ error: 'bugReport required' });

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  try {
    // Emit agent_status=running at the start of phase 3
    const onProgress = (event, data) => {
      send(event, data);
      // When phase 3 starts, fire running status for each parallel agent
      if (event === 'phase_start' && data.phase === 3) {
        (data.agents || []).forEach(id => {
          send('agent_status', { agentId: id, state: 'running' });
        });
      }
      // When phase 3 finishes, fire completed status for each agent
      if (event === 'phase_done' && data.phase === 3) {
        (data.agentTimings || []).forEach(a => {
          send('agent_status', { agentId: a.id, state: 'completed', durationMs: a.durationMs });
        });
      }
    };

    const result = await orchestrateFix(bugReport, onProgress);
    send('complete', result);
  } catch (err) {
    console.error('[server] orchestrateFix error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nBob Maintenance Co-Pilot  →  http://localhost:${PORT}\n`);
});
