# Distributed Log Aggregator (Batch 3)

This backend provides a multi-service log ingestion pipeline and a visualization dashboard.

## Features

- Ingest logs from Unix pipes without loading files into memory.
- Batch writes to MongoDB for efficient inserts.
- Time-based buffering for near-real-time ingestion with fewer write operations.
- Tenant isolation using Unix UID (or `TENANT_UID` fallback on platforms without `process.getuid`).
- Indexed log model for fast queries by tenant, timestamp, severity, and service.
- Express API for logs, filters, and aggregated stats.
- Server-Sent Events (SSE) stream endpoint for live dashboard updates.
- Browser dashboard for table + severity/service/timeline visualizations.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/log_aggregator
PORT=3000
SERVICE_NAME=orders-service
INGEST_BATCH_SIZE=500
INGEST_FLUSH_INTERVAL_MS=2000
```

3. Verify DB connectivity:

```bash
npm run db:test
```

4. Start API + dashboard:

```bash
npm start
```

Dashboard URL: `http://localhost:3000/dashboard`

## Ingestion with Unix Pipes

Examples from Git Bash, WSL, or Linux/macOS shell:

```bash
cat app.log | node ingest.js --service=orders
```

```bash
tail -f app.log | node ingest.js --service=payments
```

You can also use JSON log lines:

```text
{"timestamp":"2026-04-09T10:00:00Z","level":"ERROR","message":"Payment failed","service":"payments"}
```

## API Endpoints

- `GET /api/logs`:
  - Query params: `level`, `service`, `since`, `page`, `limit`
  - `since` supports `10m`, `6h`, `7d`, or ISO date.
- `GET /api/logs/stats`: level distribution
- `GET /api/logs/stats/services`: service distribution
- `GET /api/logs/stats/timeline`: timeline distribution
- `GET /api/logs/stream`: SSE stream for near-real-time updates
  - Query params: `level`, `service`, `since`, `cursorId`, `intervalMs`
- `GET /api/logs/services`: unique service names
- `GET /api/logs/:id`: single log by id
- `GET /health`: health check

## Git History Suggestion

Use milestone commits to track schema and API evolution:

1. `feat(ingest): robust stdin pipeline with batch flush`
2. `feat(db): add tenant/time/service indexes`
3. `feat(api): add filtering, pagination, and analytics endpoints`
4. `feat(ui): add dashboard for log visualization`
5. `docs: add setup and Unix pipe usage guide`
