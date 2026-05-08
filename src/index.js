'use strict';

const fs = require('fs');
if (fs.existsSync('.env.local')) {
    require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();
// Feature flag (default seguro): RATE_LIMIT_ENABLED=false

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3005;

app.set('trust proxy', 1);

// CORS: lista explícita. Completá CORS_ORIGIN en Railway con tus dominios (coma-separados).
// Por defecto incluye localhost + miservicio.ar para no romper dev ni prod sin env.
const corsOriginEnv = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS;
const defaultOrigins =
  'http://localhost:3000,http://127.0.0.1:3000,https://miservicio.ar,https://www.miservicio.ar';
const rawOrigins = [defaultOrigins, corsOriginEnv || ''].join(',');
const originList = [...new Set(rawOrigins.split(',').map((s) => s.trim()).filter(Boolean))];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (originList.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-internal-key'],
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

app.use(helmet());
app.use(express.json());
app.use(morgan('short'));

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'notification-service' }));
app.get('/readyz', (_req, res) => res.json({ ok: true }));

// Rutas bajo /api/v1/notifications para que el gateway pueda proxy sin reescribir path
app.use('/api/v1/notifications', require('./routes/notification.routes'));
app.use('/api/v1', require('./routes/ticket.routes'));
app.use('/api/v1/metrics', require('./routes/metrics.routes'));

// Internal endpoint for credit event ingestion from other microservices
const { ingestCreditEvent } = require('./controllers/metrics.controller');
app.post('/api/v1/internal/credit-events', ingestCreditEvent);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const { initGhostingCron } = require('./cron/ghosting.cron');
initGhostingCron();

const { initCreditScoreCron } = require('./cron/credit-score.cron');
initCreditScoreCron();

const { initFollowupCron } = require('./cron/followup.cron');
initFollowupCron();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`notification-service on :${PORT}`);
});
