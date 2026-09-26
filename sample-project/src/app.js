const express = require('express');
const { authMiddleware } = require('./auth');
const { getTasksForUser, createTask } = require('./tasks');

const app = express();
app.use(express.json());

app.get('/tasks', authMiddleware, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 2;
  const result = getTasksForUser(req.user.id, page, limit);
  res.json(result);
});

app.post('/tasks', authMiddleware, (req, res) => {
  const { title, dueDate, timezone } = req.body;
  const task = createTask(req.user.id, title, dueDate, timezone);
  res.json(task);
});

app.listen(3000, () => console.log('TaskFlow API running on 3000'));

module.exports = app;
