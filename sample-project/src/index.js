/**
 * index.js — TaskFlow API entry point
 */

const express = require('express');
const tasksRouter = require('./tasks');
const { issueToken } = require('./auth');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', version: '1.2.0' }));

// Issue a token for demo / testing (no real user auth in this sample)
app.post('/auth/token', (req, res) => {
  const { id = 1, email = 'demo@example.com', role = 'user' } = req.body ?? {};
  const token = issueToken({ id, email, role });
  res.json({ token });
});

// Task routes (all protected by authenticate middleware inside the router)
app.use('/tasks', tasksRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TaskFlow API listening on port ${PORT}`);
});

module.exports = app;
