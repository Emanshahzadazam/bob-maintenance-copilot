'use strict';
/**
 * api/examples.js — Vercel Serverless Function
 * GET /api/examples — returns the 3 canned bug report examples
 */

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

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(EXAMPLES);
};
