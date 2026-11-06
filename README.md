# 🗓️ TeamAvailability Board

A shared availability planner for small teams. Everyone marks when they are free on a common grid, the board
shows who overlaps (in each person's **own time zone**), suggests the time slots with the **most available
people**, and runs a quick meeting poll so the organiser can lock in a time.

**Stack:** React (Vite) · Node.js + Express REST API · MongoDB (Mongoose) · Zod validation · Luxon (time zones)

## Quick start

Prerequisites: Node 18+ and a running MongoDB (local, or a free MongoDB Atlas cluster).

```bash
# 1. API
cd server
cp .env.example .env          # edit MONGODB_URI if needed
npm install
npm run seed                  # optional: demo board with 5 teammates in 5 time zones
npm run dev                   # http://localhost:5000

# 2. UI (second terminal)
cd client
npm install
npm run dev                   # http://localhost:5173  (proxies /api to :5000)
```

**Single-server mode:** `cd client && npm run build`, then `cd ../server && npm start`. Express serves the built app and
the API together at http://localhost:5000.

**Demo:** after `npm run seed`, open `/b/demo-team`. To see the organiser view, open `/b/demo-team#key=demo-organiser-key`.

## How it works

1. **Create a board** with a name, a start date, 1 to 14 days, daily hours (e.g. 08:00 to 20:00) and a slot length
   (30 or 60 minutes). Days and hours are interpreted in the organiser's time zone, so daylight-saving changes are handled.
   You get an invite link to share, and become the board's **organiser**.
2. **Join** with a name. Your time zone comes from the "Show times in" selector (defaults to your browser's zone).
3. **Mark availability** on the grid: click, drag (mouse), or tap (touch). Day and time headings select a whole column or row.
   Everyone sees the same grid in their own zone; darker cells mean more people are free, and selecting a cell shows who.
4. **Best times** lists the top windows for a chosen meeting length, with who can and cannot attend and each attendee's local time.
5. **Poll**: add suggestions (or any custom time), vote "I can make this", and see conflicts before anyone commits.
   The organiser finalises one option; everyone sees the confirmed time in their own zone and can download a calendar file (.ics).

### How suggestions are chosen

A person counts as available for a meeting only if they marked **every** slot of it. Windows are ranked by:

1. **most available people** (the headline rule),
2. then **fewer attendees who would meet between 10 PM and 7 AM their own time**,
3. then the **earliest** start.

The list is made of **non-overlapping** windows, so you get genuinely different options rather than the same hour shifted
by 30 minutes. Windows no one can attend are never suggested. The logic is a pure function in `server/src/lib/suggest.js`.

## REST API

JSON in and out. Errors look like `{ "error": { "code", "message", "details?" } }`. Identity uses two secret keys sent as
headers: `X-Member-Token` (returned once when you join) and `X-Admin-Token` (returned once when the board is created).
Only SHA-256 hashes of keys are stored.

| Method | Path | Who | Description |
|---|---|---|---|
| GET | `/api/health` | anyone | 200 when the database is connected, else 503 |
| POST | `/api/boards` | anyone | Create a board (201); returns `adminToken` once |
| GET | `/api/boards/:slug` | anyone with the link | Board, members and their availability, poll options (with conflicts), `viewer` |
| GET | `/api/boards/:slug/suggestions?duration=60&limit=5` | anyone with the link | Best windows, most available people first |
| POST | `/api/boards/:slug/members` | anyone with the link | Join (201); returns the member key once |
| PUT | `/api/boards/:slug/members/:id/availability` | that member | Replace my availability `{ slots: [ISO...] }` |
| DELETE | `/api/boards/:slug/members/:id` | that member or organiser | Leave / remove; their votes are removed |
| POST | `/api/boards/:slug/options` | member | Propose a time `{ start, durationMinutes }` (proposer auto-votes) |
| PUT | `/api/boards/:slug/options/:id/vote` | member | `{ vote: true \| false }` |
| DELETE | `/api/boards/:slug/options/:id` | proposer or organiser | Remove an option |
| POST | `/api/boards/:slug/meeting` | organiser | Finalise an option `{ optionId }` (locks the poll) |
| DELETE | `/api/boards/:slug/meeting` | organiser | Reopen the poll |
| DELETE | `/api/boards/:slug` | organiser | Delete the board, members and options |

All times are UTC ISO strings (`2026-11-04T03:30:00Z`); the UI converts them for display.

## Validation and error handling

| Case | Response |
|---|---|
| Wrong type, out of range, bad date/zone, unknown field, name or title with control characters or `<>` | 400 `VALIDATION_ERROR` with per-field `details` |
| Availability or a proposed time outside the board's days/hours, or a meeting that crosses a gap between days | 400 `VALIDATION_ERROR` |
| Malformed JSON / body over 50 KB | 400 `INVALID_JSON` / 413 `PAYLOAD_TOO_LARGE` |
| Invalid id | 400 `INVALID_ID` |
| Unknown board, member, option or route | 404 |
| Missing key / key that does not match | 401 / 403 |
| Name already used on the board (case-insensitive), duplicate poll option | 409 `NAME_TAKEN` / `DUPLICATE_OPTION` |
| Board full (25 people), too many options (20), poll locked after finalising | 409 |
| Rate limit (600 requests/min; 30 boards and 80 joins per hour per IP) | 429 `RATE_LIMITED` |
| Anything unexpected | 500 `INTERNAL_ERROR` (no stack traces leaked) |

Validation runs in the browser (instant feedback) and on the server (the source of truth). Unknown fields are rejected, which also blocks
MongoDB operator injection. The server also uses `helmet` security headers, restricted CORS and a unique index on `(board, name)`.
In the UI, a rendering error shows a "Reload" message instead of a blank page, and the app keeps working if browser storage is blocked.

## Tests

```bash
cd server
npm run test:unit   # 42 tests, no database needed: slots/DST, suggestion engine, validation, routing, errors
npm test            # all 58 tests, including 16 database-backed API tests
```

`npm test` starts a throwaway MongoDB through `mongodb-memory-server` (it downloads a MongoDB binary on first run). To use your
own instance instead: `TEST_MONGODB_URI=mongodb://127.0.0.1:27017/ta_test npm test` (**that database is emptied**, never point it
at real data).

## Design notes and limits

- **No accounts.** Anyone with a board link can join. Your member key lives in your browser, so on a new device you join again with a
  new name (the organiser can remove the old entry). The organiser link (`#key=...`) works the same way: keep it private.
- Your time zone is recorded when you join. It is used for the "awkward hour" ranking and the per-person local times; the grid itself
  follows the "Show times in" selector at any time.
- The board refreshes every 15 seconds and when the tab regains focus (no websockets). Responses use ETags so unchanged polls are cheap.
- Limits: 25 people, 14 days, 20 poll options, meetings up to 8 hours, 30 or 60 minute slots.
- Boards are not deleted automatically; the organiser can delete one at any time.

## Project layout

```
server/src  app.js  index.js  seed.js
            models/index.js                       Board, Member, Option (Mongoose)
            routes/{boards,members,options}.js    REST endpoints
            lib/{slots,suggest,validation,serialize,limits}.js
            middleware/{auth,errors}.js
server/test slots / suggest / validation (no DB) and api (DB)
client/src  App.jsx  components/{Home,BoardPage,AvailabilityGrid,BestTimes,Poll,TimezoneSelect,ErrorBoundary}.jsx
            lib/{api,time,storage,useBoard}.js  styles.css
```
