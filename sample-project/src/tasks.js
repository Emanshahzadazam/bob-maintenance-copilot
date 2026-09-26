/**
 * tasks.js — Task management routes for TaskFlow API
 */

const express  = require('express');
const { paginate, formatDate, generateId } = require('./utils');
const { authenticate } = require('./auth');

const router = express.Router();

// In-memory store (replace with DB in production)
const tasks = [
  { id: 1,  title: 'Design API schema',     dueDate: '2024-03-10', owner: 'alice@example.com', status: 'done'    },
  { id: 2,  title: 'Write unit tests',       dueDate: '2024-03-12', owner: 'bob@example.com',   status: 'open'    },
  { id: 3,  title: 'Set up CI pipeline',     dueDate: '2024-03-14', owner: 'alice@example.com', status: 'open'    },
  { id: 4,  title: 'Code review PR #17',     dueDate: '2024-03-15', owner: 'carol@example.com', status: 'open'    },
  { id: 5,  title: 'Deploy to staging',      dueDate: '2024-03-18', owner: 'bob@example.com',   status: 'open'    },
  { id: 6,  title: 'Fix login redirect',     dueDate: '2024-03-20', owner: 'alice@example.com', status: 'open'    },
  { id: 7,  title: 'Update dependencies',    dueDate: '2024-03-22', owner: 'carol@example.com', status: 'open'    },
  { id: 8,  title: 'Performance profiling',  dueDate: '2024-03-25', owner: 'bob@example.com',   status: 'open'    },
  { id: 9,  title: 'Security audit',         dueDate: '2024-03-28', owner: 'alice@example.com', status: 'open'    },
  { id: 10, title: 'Release v1.2.0',         dueDate: '2024-03-31', owner: 'carol@example.com', status: 'pending' },
];

// ---------------------------------------------------------------------------
// GET /tasks — list tasks with pagination
// Uses paginate() from utils.js which contains INC-442
// ---------------------------------------------------------------------------
router.get('/', authenticate, (req, res) => {
  const page  = parseInt(req.query.page  ?? '1',  10);
  const limit = parseInt(req.query.limit ?? '3', 10);

  // INC-442 surfaces here: page=1,limit=3 returns items[3..5] instead of [0..2]
  const result = paginate(tasks, page, limit);
  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /tasks — create a new task
// ---------------------------------------------------------------------------
router.post('/', authenticate, (req, res) => {
  const { title, dueDate, timezone } = req.body;

  if (!title || !dueDate) {
    return res.status(400).json({ error: 'title and dueDate are required' });
  }

  const normalizedDue = parseDueDate(dueDate, timezone);
  const task = {
    id:      generateId(title),
    title,
    dueDate: normalizedDue,
    owner:   req.user.email,
    status:  'open',
  };

  tasks.push(task);
  res.status(201).json(task);
});

// ---------------------------------------------------------------------------
// GET /tasks/:id — fetch single task
// ---------------------------------------------------------------------------
router.get('/:id', authenticate, (req, res) => {
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// ---------------------------------------------------------------------------
// parseDueDate — parse a date string respecting the caller's timezone
//
// BUG INC-444: The `userTimezone` parameter is accepted but completely ignored.
// `new Date(dateString)` parses wall-clock strings relative to the LOCAL system
// timezone of the server (typically UTC in production), not the caller's tz.
// For a PST caller submitting "2024-03-15" the server stores "2024-03-14"
// (one day early) because PST is UTC-8 and midnight PST = 08:00 UTC of the
// same day, but the naive parse treats it as midnight UTC = previous ISO day
// after toISOString() conversion.
//
// Fix: use a library such as `date-fns-tz` or `luxon` to convert the input
// date from userTimezone to UTC before persisting:
//
//   import { fromZonedTime } from 'date-fns-tz';
//   const utc = fromZonedTime(`${dateString}T00:00:00`, userTimezone);
//   return formatDate(utc);
//
// @param {string} dateString   - "YYYY-MM-DD" from the client
// @param {string} [userTimezone='UTC'] - IANA tz string (IGNORED — INC-444)
// @returns {string}  "YYYY-MM-DD" in UTC
// ---------------------------------------------------------------------------
function parseDueDate(dateString, userTimezone = 'UTC') {
  // INC-444: userTimezone is never used — always parses as server-local time
  const date = new Date(dateString);
  return formatDate(date); // formatDate calls toISOString → UTC → may be prev day
}

module.exports = router;
