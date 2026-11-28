# Security tests: Schedule & Arrival service

12 tests, run with curl against the real API on Floci, through API Gateway. Each output is saved in `evidence/ST-xx.txt`. Every test also has a Jest unit test that runs with `npm test`.

## Setup (Git Bash)

```bash
export MSYS_NO_PATHCONV=1
API=http://localhost:4566/restapis/<API_GATEWAY_ID>/local/_user_request_
# Tokens are read without showing them on the screen, and are never saved in a file in the repo.
read -s PARENT;     # a parent token from POST /api/sessions
read -s PARENT2;    # a second parent with no child on the trip
read -s SUPERVISOR; # the supervisor of bus-1
read -s ADMIN
```

## Tests

| ID | What is tested | Request | Expected result | Real result | Pass / fail | Jest test |
|---|---|---|---|---|---|---|
| ST-01 | No token on a protected route | `curl -i $API/api/routes` | 401 `UNAUTHENTICATED` | See `evidence/ST-01.txt` | | "login validates the password and protects API routes with the issued bearer token" |
| ST-02 | A made-up token | `curl -i $API/api/routes -H "Authorization: Bearer $(printf 'x%.0s' {1..43})"` | 401, same message as ST-01 | See `evidence/ST-02.txt` | | same as ST-01 |
| ST-03 | An expired or logged-out session | Log in, `DELETE /api/sessions/current`, then use the same token on `/api/routes` | 401, same message as ST-02 | See `evidence/ST-03.txt` | | same as ST-01 |
| ST-04 | No account enumeration | `POST /api/sessions` with a real email and wrong password, then with an unknown email | Both 401 with the same body | See `evidence/ST-04.txt` | | "a wrong email and a wrong password give the same 401 answer" |
| ST-05 | No role at signup | `POST /api/users` with `{"name":"X Y","email":"x@test.com","password":"long-enough","role":"admin"}` | 400 `INVALID_INPUT`, no account made | See `evidence/ST-05.txt` | | "signup writes a bcrypt parent profile to DynamoDB and immediately returns a session" |
| ST-06 | A parent reads another family's attendance | `GET /api/trips/<trip>/attendance` with `$PARENT2` | Only his own children (empty), other records hidden as 404 | See `evidence/ST-06.txt` | | "parent only sees own child attendance and other child records are hidden as 404" |
| ST-07 | A supervisor writes on another bus | `POST /api/trips/<trip of another bus>/attendance` with `$SUPERVISOR` | 403 | See `evidence/ST-07.txt` | | "rejects attendance on another supervisor bus and invalid status" |
| ST-08 | Injection and bad input | `POST /api/sessions` with `{"email":{"$ne":null},"password":"x"}`, and `GET /api/trips/' OR 1=1/eta` | 400 or 404, no data in the body | See `evidence/ST-08.txt` | | "trip cancellation date must be a real ISO calendar date" |
| ST-09 | Brute force on login | 3 wrong passwords for one email, then a 4th try (even with the right password) | 401, 401, 401, then 429 with `Retry-After` | See `evidence/ST-09.txt` | | "3 wrong passwords, then the 4th try is blocked with 429 and Retry-After, even with the right password" |
| ST-10 | Password and token storage | `aws dynamodb get-item` on `Users` and `Sessions` (values cut to 10 characters) | `password_hash` starts with `$2`, Sessions `id` is 64 hex characters, no plain token | See `evidence/ST-10.txt` | | "signup writes a bcrypt parent profile to DynamoDB and immediately returns a session" |
| ST-11 | No secrets anywhere | `git log -p` scan, the ECS task definition environment, and the log group | No real key, password or token | See `evidence/ST-11.txt` | | "request and response logs are structured and redact authorization headers" |
| ST-12 | Detection | 6 refused requests, then `aws logs filter-log-events --filter-pattern SECURITY` and `aws cloudwatch describe-alarms` | 6 SECURITY lines, alarm `schedule-arrival-security-denied` goes to ALARM | See `evidence/ST-12.txt` | | "blocked and refused logins are logged as SECURITY lines without the password" |

Fill the last two columns after running the tests on Floci. If a test fails, write the real result. Do not hide it.
