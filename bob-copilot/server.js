const express = require('express');
const cors = require('cors');
const path = require('path');
const { orchestrateFix } = require('./orchestrator');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', async (req, res) => {
  const { bugReport } = req.body;
  if (!bugReport) return res.status(400).json({ error: 'bugReport required' });
  
  try {
    const result = await orchestrateFix(bugReport);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/examples', (req, res) => {
  res.json([
    {
      id: 'INC-442',
      title: 'Pagination returns empty + data leak',
      report: `User report: GET /tasks?page=1&limit=2 returns [] but should return 2 tasks. Also when I quickly paginate to page=2 I saw tasks from another user (user_456)! This is a data leak.

Logs: 
[ERROR] at paginate (src/utils.js:9)
GET /tasks?page=1&limit=2 returned [] expected 2 items
Security concern - INC-442`
    },
    {
      id: 'INC-443',
      title: 'Expired JWT still works - security',
      report: `Security audit: Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InVzZXJfMTIzIiwiZXhwIjoxNzEwOTI4ODAwfQ.expired 24h ago but still gets 200 OK on /tasks. 

We checked auth.js - it's using jwt.decode not verify! And there's a 24h grace period code. This is critical - INC-443`
    },
    {
      id: 'INC-444',
      title: 'Due dates off by 1 day for PST',
      report: `User in PST (America/Los_Angeles) reports: I created task with dueDate 2024-03-20, but it shows as due 2024-03-21. 

I checked - parseDueDate function in utils.js ignores timezone param! It just does new Date(dateString). 

For PST users, midnight PST is 07:00 UTC next day, so date shifts. INC-444`
    }
  ]);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bob Maintenance Co-Pilot running on http://0.0.0.0:${PORT}`);
});
