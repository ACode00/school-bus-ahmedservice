# School Bus Route Tracker Backend

Node.js and Express backend for Team 14 — Lab Group A-2. It supports administrators, bus supervisors (coordinators), and parents. Administrators manage routes, student assignments, trip schedules, and holidays; supervisors record attendance for their assigned bus; parents see their own children's attendance and alerts. ETA comes from planned stop windows; this service does not use live GPS.

The service uses a Model–Controller layout and AWS SDK v3. Floci emulates DynamoDB, SQS, CloudWatch Logs, IAM, ECS, API Gateway, and IAM Identity Center locally. Floci ElastiCache provides the shared Redis read cache. A separate SQS worker turns trip and attendance events into parent alerts.

## Requirements and local startup

- Node.js 22+, npm, Docker with Docker Compose, and Bash (Linux/macOS, Git Bash, or WSL).
- Copy .env.example to .env (PowerShell: Copy-Item .env.example .env), then run:

    docker compose up --build

Compose starts Floci and initializes resources before starting the API and worker. Floci keeps state in a named volume. The backend listens on port 3000 inside Docker, but that port is not published to the host. The API is exposed through Floci API Gateway at:

    http://localhost:4566/restapis/<api-id>/local/_user_request_

The API Gateway provisioning output contains the API ID and invoke URL. GET /health is public. Other API routes require a SigV4-signed call and a linked IAM Identity Center profile. Floci Dash is at http://localhost:4566/_floci/ui.

To initialize the services yourself, run Floci and each initializer:

    docker compose -f infra/floci/docker-compose.yml up -d
    bash infra/bootstrap.sh

The bootstrap script calls each service-specific script in dependency order. Any script can be run alone and rerun safely; none resets persistent Floci state.

| Script | What it provisions |
| --- | --- |
| infra/dynamodb.sh | Domain tables, indexes, and IdentityClaims |
| infra/sqs.sh | bus-tracker-notifications-queue |
| infra/cloudwatch-logs.sh | Backend log group and audit/worker streams |
| infra/iam.sh | Separate API, worker, and ECS execution roles |
| infra/cache.sh | Floci ElastiCache Redis cluster and smoke check |
| infra/api-gateway.sh | REST API methods, IAM auth, backend proxy, local stage |
| infra/identity-center.sh | Role groups, permission sets, route policies, assignments |
| infra/ecs.sh | ECS cluster, separate API and worker task definitions/services |

Identity Center setup requires an existing SSO_INSTANCE_ARN and SSO_IDENTITY_STORE_ID in .env. The setup script creates groups and permission sets, but not human users or group membership. Add users to BusTrackerAdmins, BusTrackerCoordinators, or BusTrackerParents in the Identity Center administration UI. Each script defaults to http://localhost:4566, uses local test credentials, and refuses non-local endpoints. Floci Redis proxy ports 6379–6399 must be available to the host for infra/cache.sh.

The Compose stack sets ECS desired task count to zero because Compose runs the API and worker containers directly. Running infra/ecs.sh by itself defaults to one task for each provisioned ECS service. When running Floci alone with a Node backend on the host, set API_BACKEND_URL=http://host.docker.internal:3000 before running infra/api-gateway.sh.

## Human authentication and authorization

Human callers use IAM Identity Center and temporary role credentials. The API has no app-managed password registration, bearer sessions, or long-lived human IAM keys. Configure an AWS CLI SSO profile, sign in with aws sso login --profile <profile>, then use its temporary credentials with an AWS SigV4 client (such as Postman AWS Signature auth with the session token, or an SDK configured with that profile).

API Gateway protects each declared method with AWS_IAM and maps the verified gateway caller ARN to X-IAM-User-Arn for the backend. The backend resolves that identity through IdentityClaims, loads the app profile, and checks the role binding. Controllers also enforce bus and child ownership. POST /api/users is admin-only and enrolls an existing Identity Store user; the service reads their name/email and transactionally links the profile. The first admin must be enrolled by the seed process or an operator with provisioning access.

Floci's local SSO OIDC flow has a single configured principal limitation. Floci verifies API Gateway SigV4 requests without evaluating the caller's execute-api:Invoke IAM policy. The app still enforces role and ownership rules, but local IAM method-policy denial is not reproduced. The permission sets are designed for AWS API Gateway; the supplied provisioning scripts target Floci, and production API Gateway-to-private-ECS networking (VPC Link/load balancer) must be configured for an AWS deployment. See Floci's [API Gateway](https://floci.io/floci/services/apigateway/) and [SSO Portal](https://floci.io/floci/services/ssoportal/) service notes.

## Optional sample data

Sample seeding is disabled by default. Create the demo admin, supervisor, and parent in Identity Store, then set SEED_SAMPLE_DATA=true, SSO_IDENTITY_STORE_ID, and the three corresponding SEED_*_IDENTITY_STORE_USER_ID values in .env. Run npm run seed. Names and emails come from Identity Store; no passwords are written. Bundled Egypt holidays are sample data, not an authoritative calendar.

## REST API routes

Base URL is the Floci invoke URL above. All routes except GET /health require SigV4. Responses below show examples; generated IDs and timestamps vary. Errors use {"error":{"code":"...","message":"..."}}. Common statuses: 400 invalid input, 401 missing/unlinked identity, 403 wrong role/bus, 404 missing or non-owned resource, 409 conflict. Shared cached reads return X-Cache: MISS then HIT.

| Method and path | Access | Example request | Expected success |
| --- | --- | --- | --- |
| GET /health | Public | — | 200 {"status":"ok"} |
| POST /api/users | Admin | {"identity_store_user_id":"<id>","role":"parent"} | 201 {"user":{"id":"<uuid>","name":"Mina Hassan","email":"mina@example.com","role":"parent"}} |
| GET /api/routes | Any linked role | Optional ?name=North&area=East | 200 [{"id":"route-1","code":"N1","name":"North","area":"East"}] |
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

POST /api/sessions and DELETE /api/sessions/current are not part of the Identity Center design.

## Tests

Run unit tests with npm test -- --runInBand. With Floci running and initialized, optional data/cache/log integration tests run with RUN_FLOCI_INTEGRATION=1 npm run test:integration. These tests do not verify concurrent local Identity Center sign-ins or AWS IAM method-policy enforcement.
