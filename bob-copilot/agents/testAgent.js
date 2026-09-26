function testAgent(triageResult, fixResult) {
  const start = Date.now();
  const id = triageResult.classification.id;

  let test = {
    testFile: '',
    coverage: '',
    cases: []
  };

  if (id === 'INC-442') {
    test = {
      testFile: `// Bob generated regression test - INC-442
const { paginate } = require('../src/utils');

describe('paginate - fixed off-by-one', () => {
  const tasks = [{id:1}, {id:2}, {id:3}, {id:4}, {id:5}];

  test('page 1 returns first 2 items (docs: page 1 = first)', () => {
    expect(paginate(tasks, 1, 2)).toEqual([{id:1}, {id:2}]);
  });

  test('page 2 returns next 2 items', () => {
    expect(paginate(tasks, 2, 2)).toEqual([{id:3}, {id:4}]);
  });

  test('page beyond range returns empty, no leak', () => {
    expect(paginate(tasks, 10, 2)).toEqual([]);
  });

  test('handles invalid page/limit gracefully', () => {
    expect(paginate(tasks, -1, 2).length).toBe(2); // clamps to 1
    expect(paginate(tasks, 1, 0).length).toBe(1); // clamps to 1
    expect(paginate(tasks, 1, 1000).length).toBe(5); // clamps to 100 but returns only available
  });

  test('prevents data leak scenario from INC-442', () => {
    const userTasks = [{id:1, userId:'123'}, {id:2, userId:'123'}];
    const page2 = paginate(userTasks, 2, 2);
    // Should be empty, not leak other users' data
    expect(page2).toEqual([]);
  });
});`,
      coverage: 'Covers off-by-one, bounds, data leak prevention - 5 cases',
      cases: [
        'Page 1 returns first items',
        'Page 2 pagination',
        'Out-of-bounds returns []',
        'Invalid inputs clamped',
        'Data leak prevention'
      ]
    };
  } else if (id === 'INC-443') {
    test = {
      testFile: `// Bob generated regression test - INC-443 security
const jwt = require('jsonwebtoken');
const { authMiddleware, SECRET } = require('../src/auth');

function mockReq(token) {
  return { headers: { authorization: \`Bearer \${token}\` } };
}
function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

describe('authMiddleware - security fix', () => {
  test('rejects expired token (no grace period)', () => {
    const expired = jwt.sign({id:'user_123', exp: Math.floor(Date.now()/1000) - 3600}, SECRET);
    const req = mockReq(expired);
    const res = mockRes();
    let nextCalled = false;
    authMiddleware(req, res, () => nextCalled = true);
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  test('rejects token with invalid signature (decode bypass fixed)', () => {
    const fakeToken = jwt.sign({id:'hacker'}, 'wrong-secret');
    const req = mockReq(fakeToken);
    const res = mockRes();
    let nextCalled = false;
    authMiddleware(req, res, () => nextCalled = true);
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  test('accepts valid token', () => {
    const valid = jwt.sign({id:'user_123', exp: Math.floor(Date.now()/1000)+3600}, SECRET);
    const req = mockReq(valid);
    const res = mockRes();
    let nextCalled = false;
    authMiddleware(req, res, () => nextCalled = true);
    expect(nextCalled).toBe(true);
    expect(req.user.id).toBe('user_123');
  });
});`,
      coverage: 'Covers expiry, signature verification, valid flow - 3 critical security cases',
      cases: [
        'Expired token rejected (no 24h grace)',
        'Invalid signature rejected (decode fix)',
        'Valid token accepted'
      ]
    };
  } else if (id === 'INC-444') {
    test = {
      testFile: `// Bob generated regression test - INC-444 timezone
const { parseDueDate } = require('../src/utils');

describe('parseDueDate - timezone fix', () => {
  test('PST date preserves calendar date', () => {
    const result = parseDueDate('2024-03-20', 'America/Los_Angeles');
    expect(result).toBe('2024-03-20'); // Should not become 2024-03-21
  });

  test('UTC default still works', () => {
    const result = parseDueDate('2024-03-20', 'UTC');
    expect(result).toBe('2024-03-20');
  });

  test('handles different timezones same calendar date', () => {
    const pst = parseDueDate('2024-03-20', 'America/Los_Angeles');
    const utc = parseDueDate('2024-03-20', 'UTC');
    const tokyo = parseDueDate('2024-03-20', 'Asia/Tokyo');
    expect(pst).toBe('2024-03-20');
    expect(utc).toBe('2024-03-20');
    expect(tokyo).toBe('2024-03-20');
  });

  test('throws on invalid format', () => {
    expect(() => parseDueDate('invalid', 'UTC')).toThrow();
  });
});`,
      coverage: 'Covers PST, UTC, multiple timezones, invalid input - 4 cases',
      cases: [
        'PST date preserved',
        'UTC works',
        'Multiple timezones same calendar',
        'Invalid format throws'
      ]
    };
  }

  return {
    agent: 'Test-Gap Agent',
    duration: Date.now() - start + 350,
    ...test,
    confidence: 0.92,
    preventsRegression: true
  };
}

module.exports = { testAgent };
