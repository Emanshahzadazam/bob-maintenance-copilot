# TaskFlow API — Sample Project

A minimal Express.js REST API for managing tasks.  
This sample project contains **three intentional bugs** documented below; they are tracked as open incidents and exist here to support debugging exercises.

---

## Quick Start

```bash
npm install
node src/index.js
```

The API listens on port `3000` by default (`PORT` env var overrides).

### Get a token

```bash
curl -s -X POST http://localhost:3000/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"id":1,"email":"alice@example.com","role":"user"}'
```

### List tasks (page 1, 3 per page)

```bash
curl -s "http://localhost:3000/tasks?page=1&limit=3" \
  -H "Authorization: Bearer <token>"
```

### Create a task

```bash
curl -s -X POST http://localhost:3000/tasks \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Fix timezone","dueDate":"2024-03-15","timezone":"America/Los_Angeles"}'
```

---

## Project Structure

```
sample-project/
├── src/
│   ├── index.js   — Express app + entry point
│   ├── auth.js    — JWT middleware & token issuance
│   ├── tasks.js   — Task CRUD routes + parseDueDate
│   └── utils.js   — paginate(), formatDate(), generateId()
├── logs/
│   └── error.log  — Stack traces for each known incident
└── README.md
```

---

## Known Bugs / Open Incidents

### INC-442 — Pagination off-by-one + missing bounds check (`utils.js` line 19)

**Symptom:** `GET /tasks?page=1&limit=3` returns items 4–6 instead of items 1–3.  
Page 1 is completely skipped; requesting the last page can return `undefined` entries
if `page * limit` exceeds the dataset length.

**Root cause:** [`paginate()`](src/utils.js) computes `start = page * limit` instead
of the correct `start = (page - 1) * limit`.  The off-by-one shifts every window by
one full page, and because `end` is never clamped there is no bounds check against
`data.length`.

**Impact:** All paginated list endpoints return wrong records.  On the final page,
`undefined` entries leak into the JSON response, potentially exposing internal array
state to clients.

**Fix:**
```js
// utils.js line 19
const start = (page - 1) * limit;                     // was: page * limit
const end   = Math.min(start + limit, data.length);   // add bounds clamp
```

---

### INC-443 — JWT decoded without signature verification + 24 h grace period (`auth.js`)

**Symptom 1 — signature bypass:** Any request bearing a JWT with a valid JSON structure
(but an arbitrary or forged signature) is accepted.  Attackers can escalate privileges
by crafting a token with `"role":"admin"`.

**Symptom 2 — expired-token acceptance:** Tokens that have passed their `exp` claim
continue to be accepted for up to 24 hours afterward.

**Root cause:**  
- [`authenticate()`](src/auth.js) calls `jwt.decode(token)` which **never** validates
  the signature. The correct call is `jwt.verify(token, SECRET)`.  
- `GRACE_PERIOD_SECONDS` is set to `86 400` (24 hours), so the expiry guard only fires
  after `exp + 86400 < now`.

**Impact:** Complete authentication bypass.  Any forged token is treated as valid.
Expired session tokens remain active for a full extra day.

**Fix:**
```js
// auth.js — replace jwt.decode with jwt.verify
const payload = jwt.verify(token, SECRET);   // throws on bad sig or expiry
// Remove GRACE_PERIOD_SECONDS entirely (set to 0 or delete the variable)
```

---

### INC-444 — `parseDueDate` ignores timezone parameter, PST off-by-one day (`tasks.js`)

**Symptom:** A user in `America/Los_Angeles` (UTC−8) submits `dueDate: "2024-03-15"`.
The API stores `"2024-03-14"` — one day earlier than intended.

**Root cause:** [`parseDueDate(dateString, userTimezone)`](src/tasks.js) accepts the
`userTimezone` argument but never uses it.  `new Date("2024-03-15")` is parsed as
`2024-03-15T00:00:00Z` (midnight UTC).  `toISOString()` then returns `"2024-03-14"`
for any server running in UTC because the date object stores milliseconds since epoch
without any local-time adjustment.

**Impact:** Tasks for users west of UTC are systematically stored one calendar day
early, causing missed-deadline notifications and incorrect due-date filtering.

**Fix:**
```js
const { fromZonedTime } = require('date-fns-tz');

function parseDueDate(dateString, userTimezone = 'UTC') {
  const utc = fromZonedTime(`${dateString}T00:00:00`, userTimezone);
  return formatDate(utc);
}
```

---

## Dependencies

| Package       | Version | Purpose                          |
|---------------|---------|----------------------------------|
| express       | ^4.18   | HTTP framework                   |
| jsonwebtoken  | ^9.0    | JWT sign / verify                |
| date-fns-tz   | ^3.1    | *(not yet used — needed for fix)*|

---

## Environment Variables

| Variable     | Default                  | Description              |
|--------------|--------------------------|--------------------------|
| `PORT`       | `3000`                   | HTTP listen port         |
| `JWT_SECRET` | `taskflow-dev-secret`    | HMAC secret for JWTs     |
