// k6 load test for the trip ETA endpoint (Lab 8 stages and thresholds).
// Run:  k6 run -e API=<gateway base url> -e TOKEN=<parent token> -e TRIP=<trip id> k6/schedule-load.js
// The token is passed on the command line only. Never write it in this file.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const cacheHits = new Counter('eta_cache_hits');
const rateLimited = new Counter('rate_limited_429');

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

const API = __ENV.API;
const TOKEN = __ENV.TOKEN;
const TRIP = __ENV.TRIP || 'trip:route-demo-maadi:morning';

export default function () {
  const res = http.get(`${API}/api/trips/${encodeURIComponent(TRIP)}/eta`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (res.headers['X-Cache'] === 'HIT') cacheHits.add(1);
  if (res.status === 429) rateLimited.add(1);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
