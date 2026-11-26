# School Bus Route Tracker Backend

Node.js and Express backend for Team 14 — Lab Group A-2. It supports administrators, bus supervisors (coordinators), and parents. Administrators manage routes, student assignments, trip schedules, and holidays; supervisors record attendance for their assigned bus; parents see their own children's attendance and alerts. ETA comes from planned stop windows; this service does not use live GPS.

The service uses a Model–Controller layout and AWS SDK v3. Floci emulates DynamoDB, SQS, CloudWatch Logs, IAM, ECS, and API Gateway locally. Floci ElastiCache provides the shared Redis read cache. A separate SQS worker turns trip and attendance events into parent alerts.

## Requirements and local startup

- Node.js 22+, npm, Docker with Docker Compose, and Bash (Linux/macOS, Git Bash, or WSL).
- Copy .env.example to .env (PowerShell: Copy-Item .env.example .env), then run:

    docker compose up --build

Compose starts Floci and initializes resources before starting the API and worker. Floci keeps state in a named volume. The backend listens on port 3000 inside Docker, but that port is not published to the host. The API is exposed through Floci API Gateway at:

    http://localhost:4566/restapis/<api-id>/local/_user_request_

The API Gateway provisioning output contains the API ID and invoke URL. GET /health, signup, and login are public. Protected API routes use an app bearer session created by email/password login. Floci Dash is at http://localhost:4566/_floci/ui.

To initialize the services yourself, run Floci and each initializer:

    docker compose -f infra/floci/docker-compose.yml up -d
    bash infra/bootstrap.sh

The bootstrap script calls each service-specific script in dependency order. Any script can be run alone and rerun safely; none resets persistent Floci state.

| Script | What it provisions |
| --- | --- |
| infra/dynamodb.sh | Domain tables, email uniqueness claims, 8-hour sessions, and TTL |
| infra/sqs.sh | bus-tracker-notifications-queue |
| infra/cloudwatch-logs.sh | Backend log group and audit/worker streams |
| infra/iam.sh | Separate API, worker, and ECS execution roles |
| infra/cache.sh | Floci ElastiCache Redis cluster and smoke check |
| infra/api-gateway.sh | REST API methods, backend proxy, local stage |
| infra/ecs.sh | ECS cluster, separate API and worker task definitions/services |

Each script defaults to http://localhost:4566, uses local test credentials, and refuses non-local endpoints. Floci Redis proxy ports 6379–6399 must be available to the host for infra/cache.sh.

The Compose stack sets ECS desired task count to zero because Compose runs the API and worker containers directly. Running infra/ecs.sh by itself defaults to one task for each provisioned ECS service. When running Floci alone with a Node backend on the host, set API_BACKEND_URL=http://host.docker.internal:3000 before running infra/api-gateway.sh.

## Human authentication and authorization

Parents create an account with their name, email, and password on the frontend signup page. `POST /api/users` normalizes email, writes a bcrypt password hash and user profile to DynamoDB, and immediately returns a random bearer token. Public signup always creates the `parent` role; it does not accept a caller-selected role. Admin and supervisor accounts must be created or promoted by an operator.

`POST /api/sessions` checks the bcrypt hash and issues a new 8-hour session. Only the SHA-256 hash of the session token is stored in the `Sessions` table; DynamoDB TTL removes expired rows, and the auth middleware checks expiry on every request. `DELETE /api/sessions/current` revokes the current session. API Gateway forwards the requests to Express, where `requireAuth`, `requireRole`, and ownership checks enforce access. Supervisors can only act on their assigned buses; parents can only view their own children and alerts.

Passwords are never returned by the API. Email uniqueness is enforced transactionally through `UserEmails`. For production deployment, serve the frontend and API over HTTPS and keep the bearer token private; configure API Gateway-to-private-ECS networking (for example VPC Link/load balancer) for AWS.

## Optional sample data

Sample seeding is disabled by default. Set `SEED_SAMPLE_DATA=true` and provide `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_SUPERVISOR_EMAIL`, `SEED_SUPERVISOR_PASSWORD`, `SEED_PARENT_EMAIL`, and `SEED_PARENT_PASSWORD` in `.env`, then run `npm run seed`. Seed accounts retain their specified roles; public signup cannot create admin or supervisor users. Bundled Egypt holidays are sample data, not an authoritative calendar.

## REST API routes

Base URL is the Floci invoke URL above. Signup, login, and GET /health are public; other routes require `Authorization: Bearer <token>`. Responses below show examples; generated IDs and timestamps vary. Errors use {"error":{"code":"...","message":"..."}}. Common statuses: 400 invalid input, 401 invalid/expired session, 403 wrong role/bus, 404 missing or non-owned resource, 409 conflict. Shared cached reads return X-Cache: MISS then HIT.

| Method and path | Access | Example request | Expected success |
| --- | --- | --- | --- |
| GET /health | Public | — | 200 {"status":"ok"} |
| POST /api/users | Public | {"name":"Mina Hassan","email":"mina@example.com","password":"at-least-8-chars"} | 201 {"token":"<random-token>","expires_at":<epoch-seconds>,"user":{"id":"<uuid>","name":"Mina Hassan","email":"mina@example.com","role":"parent"}} |
| POST /api/sessions | Public | {"email":"mina@example.com","password":"at-least-8-chars"} | 200 session token, expiry, and user profile |
| DELETE /api/sessions/current | Signed-in user | — | 204; revokes the current session |
| GET /api/routes | Any signed-in role | Optional ?name=North&area=East | 200 [{"id":"route-1","code":"N1","name":"North","area":"East"}] |
| GET /api/routes/:id | Any linked role | — | 200 route object |
| GET /api/routes/:id/stops | Any linked role | — | 200 array of stop objects |
| GET /api/routes/stops/:id | Any linked role | — | 200 one stop object |
| GET /api/stops/:id | Any linked role | — | 200 one stop object |
| POST /api/routes | Admin | {"code":"N1","name":"North","area":"East"} | 201 created route with generated ID |
| PATCH /api/routes/:id | Admin | Non-empty subset of code, name, area | 200 updated route |
| DELETE /api/routes/:id | Admin | — | 204; 409 while buses/trips use route |
| POST /api/routes/:id/stops | Admin | {"name":"Main Gate","stop_order":1} | 201 created stop with ID and route_id |
| PATCH /api/routes/:id/stops/:stopId | Admin | Non-empty subset of name, stop_order | 200 updated stop |
| DELETE /api/routes/:id/stops/:stopId | Admin | — | 204; 409 if student/schedule uses stop |
| POST /api/students | Admin | {"name":"Omar Hassan","parent_id":"parent-1","stop_id":"stop-1","bus_id":"bus-1"} | 201 student object with generated ID |
| GET /api/trips/:id/eta | Admin, supervisor, parent | — | 200 trip and ordered stops with arrive_from/arrive_to; X-Cache |
| PUT /api/trips/:id/times | Admin | {"stops":[{"stop_id":"stop-1","arrive_from":"06:55","arrive_to":"07:05"}]} | 200 trip_id and updated stop windows |
| PATCH /api/trips/:id/status | Admin | {"status":"cancelled","cancelled_date":"2026-11-26"} | 200 updated trip object |
| POST /api/trips/:id/attendance | Supervisor assigned to bus | {"student_id":"student-1","date":"2026-11-26","status":"boarded"} | 201 attendance object with marked_by |
| GET /api/trips/:id/attendance | Admin, assigned supervisor, parent of child | Optional ?limit=50&cursor=<base64url> | 200 attendance array; parents see only their children; optional X-Next-Cursor |
| PATCH /api/attendance/:id | Admin or assigned supervisor | {"status":"dropped"} | 200 corrected attendance |
| GET /api/holidays?year=2026 | Any linked role | Four-digit year required | 200 holiday array; X-Cache |
| POST /api/holidays | Admin | {"date":"2026-01-07","name":"Coptic Christmas","year":"2026"} | 201 created holiday |
| PATCH /api/holidays/:id | Admin | Non-empty subset of date, name, year | 200 updated holiday |
| DELETE /api/holidays/:id | Admin | — | 204 |
| GET /api/alerts | Parent | Optional ?limit=50&cursor=<base64url> | 200 alert array belonging to parent; optional X-Next-Cursor |
| GET /api/alerts/current | Parent | Same as GET /api/alerts | 200 same alert array |
| PATCH /api/alerts/:id/read | Parent who owns alert | — | 200 alert with is_read:true; another parent's alert is 404 |

## Tests

Run unit tests with npm test -- --runInBand. With Floci running and initialized, optional data/cache/log integration tests run with RUN_FLOCI_INTEGRATION=1 npm run test:integration.
