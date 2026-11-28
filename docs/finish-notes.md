# What changed in this update, and what to say in the discussion

Read this before the discussion. The doctor will ask you about these parts.

## 1. Alerts and holidays were removed

`/api/alerts` and `/api/holidays` were the same as in Ali's Favorites & Alerts service. Two services doing the same job is bad design, and it makes it unclear who built what. Now:
- Ali's service owns alerts and holidays.
- My worker still writes parent alerts (attendance and trip changes) into the shared `Alerts` table.
- The sample holidays were removed from the seed, because their ids stopped Ali's service from loading real holidays from Calendarific.

## 2. Login brute force protection (new)

File: `services/login-limiter.service.js`, used in `controllers/sessions.controller.js`.
- After 3 wrong passwords for one email in 10 minutes, the next login gives **429 Too Many Requests** with a `Retry-After` header, for 10 minutes. This is true even if the 4th password is right.
- A correct login before the 3rd failure resets the count.
- The counts are in **Redis (ElastiCache)**, not in memory. ECS can run more than one copy of the API, and memory is not shared between copies.
- The key is a SHA-256 hash of the email, so emails are not stored in Redis as plain text.
- If Redis is down, logins still work and bcrypt still checks the password. We do not lock everyone out.
- Why no per-IP limit by default: behind API Gateway every request reaches ECS from the gateway's address. An IP limit would block all users at once. It can be turned on with `maxIpFailures` when the real client IP reaches the app.
- Wrong email and wrong password still give the same 401 message, so nobody can find out which emails exist.

## 3. Monitoring (new)

- Every 401, 403 and 429 answer is logged as one `SECURITY` line, in `middleware/error-handler.js`. It has the reason, method, path, request id and user id. It never has the token or the password.
- `scripts/provision/cloudwatch.js` now also creates:
  - metric filter `schedule-arrival-security-denied` (pattern `SECURITY`) and an alarm when there are 5 or more in 5 minutes,
  - metric filter `schedule-arrival-server-errors` (pattern `"Request failed"`) and an alarm on any 5xx in 5 minutes.
- The filters use text patterns, because JSON patterns did not match on Floci.
- New dependency: `@aws-sdk/client-cloudwatch` (for the alarms).

## 4. Tests

- `tests/unit/login-limit.test.js` has 10 new tests: the 3-try block, the reset, the same 401 for wrong email and password, the SECURITY lines, the memory and Redis stores, Redis down, the IP limit, and the CloudWatch filters and alarms.
- `tests/unit/removed-routes.test.js` checks that alerts and holidays now give 404.
- `npm test`: 80 passed, 13 skipped (the Floci integration tests, which only run with `RUN_FLOCI_INTEGRATION=1`).

## 5. Docs

- `docs/threat-model.md`: 11 threats in a STRIDE table, each with the file that blocks it and the test that proves it.
- `docs/security-tests.md`: 12 security tests with the exact requests. Run them on Floci and save the outputs in `evidence/`.
- `docs/load-test.md` and `k6/schedule-load.js`: the Lab 8 load test on the trip ETA.
- `.env.example`: every variable the code reads, with a comment, and placeholders only.

## 6. Still to do on Floci

1. Run the 12 security tests and save `evidence/ST-01.txt` to `ST-12.txt`. Fill the last two columns of `docs/security-tests.md`.
2. Run k6 and save `evidence/k6-schedule.txt`. Fill the table in `docs/load-test.md`.
3. Take screenshots of DynamoDB, ECS, SQS, ElastiCache, API Gateway, CloudWatch (logs and the 2 alarms) and `npm test`.

## Questions you may get

- **Why 3 tries?** It is low enough to stop guessing, and a real parent rarely gets it wrong 3 times in 10 minutes.
- **Why Redis and not memory?** Because ECS can run more than one copy, and each copy has its own memory.
- **Why the same error for wrong email and wrong password?** So an attacker cannot find which emails have accounts.
- **Where is the token stored?** Only its SHA-256 hash is in DynamoDB. The real token is only in the browser.
- **What does the alarm do?** It turns to ALARM in CloudWatch. It has no action yet (no email). That is written as a limit in the threat model.
