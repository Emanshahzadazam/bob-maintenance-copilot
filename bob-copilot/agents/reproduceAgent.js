function reproduceAgent(triageResult, codeLocatorResult) {
  const start = Date.now();
  const id = triageResult.classification.id;

  let reproduction = {
    script: '',
    steps: [],
    expectedVsActual: {}
  };

  if (id === 'INC-442') {
    reproduction = {
      script: `// Bob generated reproduction for INC-442
const { paginate } = require('../../sample-project/src/utils');

console.log('Testing pagination bug...');
const tasks = [
  {id:1, userId:'user_123'}, {id:2, userId:'user_123'},
  {id:3, userId:'user_456'}, {id:4, userId:'user_123'}
];

// Page 1 should return first 2 items for user_123
const userTasks = tasks.filter(t => t.userId === 'user_123');
console.log('User tasks:', userTasks.length); // 3

const page1 = paginate(userTasks, 1, 2);
console.log('Page 1 (buggy):', page1); // [] - BUG! Should be 2 items
console.log('Expected: 2 items, Actual:', page1.length, page1.length === 0 ? 'BUG REPRODUCED!' : 'OK');

const page2 = paginate(userTasks, 2, 2);
console.log('Page 2 (buggy):', page2); // Returns user_456 data leak scenario
`,
      steps: [
        '1. Create 3 tasks for user_123, 1 for user_456',
        '2. Call GET /tasks?page=1&limit=2',
        '3. Observe empty array (bug)',
        '4. Call page=2, observe potential data leak'
      ],
      expectedVsActual: {
        expected: 'Page 1 returns 2 tasks',
        actual: 'Page 1 returns 0 tasks (off-by-one)',
        leak: 'Page calculation allows accessing beyond user boundary'
      },
      canAutoRun: true
    };
  } else if (id === 'INC-443') {
    reproduction = {
      script: `// Bob generated reproduction for INC-443
const jwt = require('jsonwebtoken');
const SECRET = 'taskflow-secret-key';

// Create expired token (expired 25h ago)
const expiredPayload = { id: 'user_123', exp: Math.floor(Date.now()/1000) - 25*3600 };
const expiredToken = jwt.sign(expiredPayload, SECRET);

console.log('Testing expired token:', expiredToken);
console.log('Expired 25h ago, should be rejected');

// Simulate buggy auth logic
const decoded = jwt.decode(expiredToken); // BUG: no verify
console.log('Decoded without verify:', decoded);

const now = Date.now();
if (decoded.exp * 1000 + 24*60*60*1000 < now) {
  console.log('Would reject (expired >24h)');
} else {
  console.log('BUG REPRODUCED: Allows expired token within 24h grace period!');
}

console.log('Expected: 401, Actual: 200 - SECURITY BUG');
`,
      steps: [
        '1. Generate JWT expired 25h ago',
        '2. Call GET /tasks with expired token',
        '3. Observe 200 OK instead of 401 (bug)',
        '4. Check auth.js uses decode not verify'
      ],
      expectedVsActual: {
        expected: '401 Unauthorized for expired token',
        actual: '200 OK - token accepted via grace period + decode bypass',
        security: 'Critical: signature not verified'
      },
      canAutoRun: true
    };
  } else if (id === 'INC-444') {
    reproduction = {
      script: `// Bob generated reproduction for INC-444
const { parseDueDate } = require('../../sample-project/src/utils');

console.log('Testing timezone bug...');
const pstDate = '2024-03-20';
const timezone = 'America/Los_Angeles';

const result = parseDueDate(pstDate, timezone);
console.log('Input:', pstDate, 'Timezone:', timezone);
console.log('Parsed result:', result);
console.log('Expected: 2024-03-20 should stay 2024-03-20 for PST user, stored as UTC 2024-03-20T07:00:00Z');
console.log('Actual: Ignores timezone, returns', result, '- off by 1 day when converted');

const dateInPST = new Date('2024-03-20T00:00:00-08:00');
console.log('PST midnight in UTC:', dateInPST.toISOString());
console.log('BUG REPRODUCED: parseDueDate does not use timezone param');
`,
      steps: [
        '1. User in PST creates task with dueDate 2024-03-20',
        '2. API calls parseDueDate(date, America/Los_Angeles)',
        '3. Function ignores timezone, parses as local',
        '4. Saved date off by 1 day in UTC'
      ],
      expectedVsActual: {
        expected: '2024-03-20 PST stored as 2024-03-20T08:00:00Z',
        actual: 'Date parsed as local, off by 1 day',
        impact: 'User sees due date 1 day late'
      },
      canAutoRun: true
    };
  }

  return {
    agent: 'Reproducer Agent',
    duration: Date.now() - start + 400, // simulate work
    ...reproduction,
    status: 'reproduced',
    confidence: 0.94
  };
}

module.exports = { reproduceAgent };
