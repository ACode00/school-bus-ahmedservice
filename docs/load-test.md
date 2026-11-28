# Load test: trip ETA

Script: `k6/schedule-load.js`. It uses the Lab 8 stages (up to 10 users, then 50, then down to 0) and thresholds (p95 under 500 ms, under 5% failed).

It calls `GET /api/trips/{id}/eta` as a parent. The answer is cached in Redis (ElastiCache), so most calls should be cache hits (`X-Cache: HIT`).

## How to run

```bash
k6 run -e API=http://localhost:4566/restapis/<API_GATEWAY_ID>/local/_user_request_ -e TOKEN=<parent token> -e TRIP=trip:route-demo-maadi:morning k6/schedule-load.js | tee evidence/k6-schedule.txt
```

## Results

| Measure | Value |
|---|---|
| p95 response time | (fill from `evidence/k6-schedule.txt`) |
| Failed rate | |
| Requests per second | |
| 429 answers | |
| Cache hits | |
| Thresholds passed | |

Note: everything runs on one laptop through Floci, so the numbers are lower than on real AWS. If a threshold fails, it stays as it is, and the reason is written here.
