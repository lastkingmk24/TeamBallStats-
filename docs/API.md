# TeamBallStats server API

This is the JSON API of the optional team sync server (`server/`). The static
app works without it. Only the cloud sync panel, the Pro panel, and the
sign-in-based features call these routes.

Base URL: the server origin (for example `https://stats.example.org`). All
paths below start with `/api`. The browser calls them with relative URLs, so
the app and the API must share an origin.

## Conventions

* **Format.** Requests with a body must send `Content-Type: application/json`,
  otherwise the server answers `415 unsupported_media_type`. API responses are
  JSON with `Cache-Control: no-store`.
* **Size.** Bodies larger than `MAX_BODY_BYTES` get `413`.
* **Errors.** Every error has the shape `{ "error": "<code>", "message": "<text>" }`.
  Some errors add fields (see below). Unknown API routes return `404 not_found`,
  and a known path with the wrong method returns `405 method_not_allowed`.
* **Session.** Sign-in sets the `tbs_session` cookie: `HttpOnly`,
  `SameSite=Lax`, `Path=/`, 30 days. `Secure` is added when `COOKIE_SECURE=1`.
  The server stores only a SHA-256 hash of the session token.
* **Passwords.** Stored as `scrypt$…` hashes. Usernames are 3–32 characters
  (letters, numbers, dot, dash, underscore). Passwords are 8–200 characters.

## Error codes

| HTTP | `error`                     | Meaning                                                                 |
|------|-----------------------------|-------------------------------------------------------------------------|
| 400  | `invalid_input`             | A field is missing or has the wrong type or value.                      |
| 400  | `invalid_document`          | A league document failed normalisation.                                 |
| 400  | `bad_json`                  | The body is not valid JSON.                                             |
| 401  | `sign_in_required`          | No valid session. Sign in first.                                        |
| 401  | `invalid_credentials`       | Wrong username or password at sign-in.                                  |
| 401  | `bad_signature`             | Webhook `X-TBS-Signature` does not match the body.                      |
| 403  | `pro_required`              | The feature needs an active Pro entitlement. Response includes `feature` and `entitlement`. |
| 403  | `registration_closed`       | `ALLOW_REGISTRATION=0`.                                                 |
| 404  | `no_cloud_league`           | The account has no cloud copy yet. Sync first.                          |
| 404  | `not_found`                 | Unknown route, or a revision that is no longer kept.                    |
| 404  | `game_not_found`            | The game id is not in the league.                                       |
| 404  | `user_not_found`            | Webhook refers to a username that does not exist.                       |
| 409  | `username_taken`            | Registration with an existing username.                                 |
| 409  | `conflict`                  | Stale `baseRevision`. Response includes the cloud `revision`, `updatedAt`, `summary`, and `document`. Nothing was written. |
| 409  | `empty_overwrite`           | An empty league would replace data. Nothing was written unless `allowEmpty: true`. |
| 405  | `method_not_allowed`        | Known route, wrong HTTP method.                                         |
| 413  | `too_large`                 | Body exceeds `MAX_BODY_BYTES`.                                          |
| 415  | `unsupported_media_type`    | Body is not `application/json`.                                         |
| 429  | `too_many_attempts`         | Login throttle: wait 15 minutes.                                        |
| 501  | `payments_not_configured`   | No payment provider is connected. Checkout is refused on purpose.       |

## Health

### `GET /api/health`

```json
{ "ok": true, "version": "1.0.0", "time": "2026-11-13T07:47:03.271Z",
  "billing": { "checkout": "not_configured", "webhook": "not_configured" } }
```

## Accounts

### `POST /api/auth/register`

Request: `{ "username": "coach_lee", "password": "at-least-8" }`

Response `200` sets the session cookie and returns
`{ "user": { "id": "...", "username": "coach_lee" }, "entitlement": {...} }`. Errors: `400 invalid_input`,
`409 username_taken`, `403 registration_closed`.

### `POST /api/auth/login`

Request: `{ "username": "...", "password": "..." }`

Response `200` sets the session cookie and returns `{ "user": { "id": "...", "username": "..." }, "entitlement": {...} }`.
A wrong username or password gets `401 invalid_credentials` with a generic message. Repeated failures from one IP for one username
return `429 too_many_attempts` for 15 minutes.

### `POST /api/auth/logout`

Invalidates the session and clears the cookie (`Max-Age=0`). Always `200`. Clears the cookie (`Max-Age=0`).

### `GET /api/auth/me`

`200 { "user": { "username": "..." }, "entitlement": { "plan": "free" | "pro", "active": true | false, "status": "...", "source": "manual" | "webhook" | null, "periodEnd": "ISO-8601" | null } }`.
Without a session: `401 sign_in_required`.

## League sync

Each account has one cloud league, and every accepted write creates a new
**revision**. Writes use optimistic concurrency: a write must name the revision
it was based on.

### `GET /api/league`

Without a cloud copy yet:
`{ "revision": 0, "updatedAt": null, "summary": null, "document": null }`.
Otherwise `{ "revision": 3, "updatedAt": "...", "summary": {...}, "document": {...} }`.

`summary` holds counts (teams, players, games, stat lines) for display without
parsing the document.

### `PUT /api/league`

Request:

```json
{ "baseRevision": 3,
  "document": { "schema": 3, "league": {...}, "teams": [...], "players": [...], "games": [...], "statLines": [...], "events": [...] },
  "allowEmpty": false }
```

* `baseRevision` is required. Use `0` for the first upload. It must be a whole number.
* The document is normalised on the server (`engine.normalize`) and stored in
  normalised form. Malformed documents return `400 invalid_document`.
* If `baseRevision` is not the current revision, the write is refused with
  `409 conflict` and the response contains the cloud copy. Nothing is written.
  The browser then shows a merge dialog.
* A document with no players or games cannot replace a non-empty cloud copy
  unless `allowEmpty: true` (`409 empty_overwrite` otherwise).

Success `200`: `{ "revision": 4, "updatedAt": "...", "summary": {...} }`.

### `GET /api/league/revisions`

`{ "revisions": [ { "revision": 4, "createdAt": "...", "summary": {...} }, ... ] }`,
newest first. The server keeps the last **50** revisions (`REVISIONS_KEEP`).

### `GET /api/league/revisions/:rev`

`{ "revision": 3, "createdAt": "...", "document": {...} }`. Used by the browser
for the three-way merge, where the base is the last revision this device synced.
Pruned or unknown revisions return `404 not_found`.

## Billing

Pro access is an **entitlement** on the account. No payment provider is
bundled, so no money is taken by this server. The operator can grant Pro with
the CLI (see [DEPLOY.md](DEPLOY.md)).

### `GET /api/billing/status`

`{ "signedIn": true, "entitlement": {...}, "checkout": "not_configured", "webhook": "not_configured" | "configured", "message": "..." }`.
Works signed-out too (`signedIn: false`, free entitlement).

### `POST /api/billing/checkout`

Always `501 payments_not_configured` (`401 sign_in_required` when signed out). It does not
fake a purchase.

### `POST /api/billing/webhook`

For a payment provider or any billing bridge to call. Requires
`BILLING_WEBHOOK_SECRET`. While it is empty, every request gets `501`.

Headers: `X-TBS-Signature: sha256=<hex>`, where `<hex>` is the HMAC-SHA256 of the
**raw request body** using the secret. The comparison is constant-time.

Body:

```json
{ "id": "evt_123", "type": "entitlement.activated",
  "data": { "username": "coach_lee", "periodEnd": "2027-01-01T00:00:00Z" } }
```

* Supported types: `entitlement.activated` (Pro on) and `entitlement.canceled`
  (Pro off, takes effect immediately). Other types are recorded and ignored.
* Each `id` is applied once. A repeat returns `200 { "ok": true, "duplicate": true }`.
* An unknown `username` returns `404 user_not_found`. The event is not recorded.

Example (shell):

```bash
body='{"id":"evt_1","type":"entitlement.activated","data":{"username":"coach_lee"}}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$BILLING_WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST https://stats.example.org/api/billing/webhook \
  -H 'Content-Type: application/json' -H "X-TBS-Signature: sha256=$sig" --data "$body"
```

## Game insights (legacy API paths)

The app computes insights locally for everyone, including offline. These legacy
server routes remain available to signed-in accounts without an entitlement
check. Authentication still protects each account's cloud document.

Both routes take either `document` (the league to analyse) or nothing, in which
case the account's cloud copy is used.

### `POST /api/pro/recap`

Request: `{ "gameId": "g-1", "document": {...} /* optional */ }`

Response: the `gameRecap` result.

* `measured`: score, status, margin, winner, quarters, teams, largest run, lead
  changes, top performers. These are computed from the stored data.
* `analysis`: rule-based statements. Each item has a `basis` that says which
  measured figures it rests on.
* `labels.analysis`: states that the analysis is rule-based and not produced by
  a language model.

Errors: `401` (signed-out), `404 game_not_found`,
`404 no_cloud_league`.

### `POST /api/pro/lineups`

Request: `{ "minMinutes": 5 /* optional */, "document": {...} /* optional */ }`

Response: `{ "rankings": [...], "note": "..." }`. `rankings` lists five-player
lineups that played at least `minMinutes` (default 3), best first by net points
per 10 minutes, with `rank`, `pf`, `pa`, `net`, `netPer10`, and `minutes`.
Without substitution events `rankings` is empty and `note` explains why.
Errors are as for `recap`.

## Operator CLI

These commands run on the server host, not over HTTP.

```
node server/cli.js list-users
node server/cli.js grant-pro <username> [--days N | --forever]   # default 30 days
node server/cli.js revoke-pro <username>
```

These legacy entitlement commands do not gate app insights.

`grant-pro` is a manual grant (`source: "manual"`). No payment is involved.
Each grant and revoke writes an `audit_log` row with actor `cli`.
