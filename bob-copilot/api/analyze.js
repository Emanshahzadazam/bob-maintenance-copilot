'use strict';
/**
 * api/analyze.js — Vercel Serverless Function
 *
 * POST /api/analyze
 *
 * Vercel serverless functions do not support true long-lived SSE streams.
 * This endpoint runs the full 3-phase orchestrator synchronously and returns
 * a single JSON response containing all events + the final result, so the
 * frontend can replay them client-side for the same animated experience.
 *
 * Response shape:
 *   { events: Array<{ event, data }>, result: { ...full result object } }
 */

const path = require('path');
// Resolve agents relative to this file's location (api/ dir)
const { orchestrateFix } = require(path.join(__dirname, '..', 'orchestrator'));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bugReport } = req.body || {};
  if (!bugReport) {
    return res.status(400).json({ error: 'bugReport required' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Collect all SSE events that the orchestrator emits
  const events = [];
  const onProgress = (event, data) => {
    events.push({ event, data });
    // Mirror the agent_status events the Express server generates
    if (event === 'phase_start' && data.phase === 3) {
      (data.agents || []).forEach(id => {
        events.push({ event: 'agent_status', data: { agentId: id, state: 'running' } });
      });
    }
    if (event === 'phase_done' && data.phase === 3) {
      (data.agentTimings || []).forEach(a => {
        events.push({ event: 'agent_status', data: { agentId: a.id, state: 'completed', durationMs: a.durationMs } });
      });
    }
  };

  try {
    const result = await orchestrateFix(bugReport, onProgress);
    events.push({ event: 'complete', data: result });
    return res.status(200).json({ events, result });
  } catch (err) {
    console.error('[api/analyze] error:', err);
    events.push({ event: 'error', data: { message: err.message } });
    return res.status(500).json({ events, error: err.message });
  }
};
