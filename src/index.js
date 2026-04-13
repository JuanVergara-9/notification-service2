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

// CORS: permitir frontend (miservicio.ar) y preflight para asignación de tickets
// En producción conviene restringir: CORS_ORIGIN=https://miservicio.ar,https://www.miservicio.ar
const corsOriginEnv = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS;
const originList = corsOriginEnv
  ? corsOriginEnv.split(',').map(s => s.trim()).filter(Boolean)
  : null; // null = permitir cualquier origen (temporal para probar preflight)
const corsOptions = {
  origin: originList
    ? (origin, callback) => {
        if (!origin) return callback(null, true);
        if (originList.includes(origin)) return callback(null, true);
        return callback(new Error('CORS not allowed'), false);
      }
    : true, // temporalmente permisivo para probar
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true,
  optionsSuccessStatus: 204
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

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const { initGhostingCron } = require('./cron/ghosting.cron');
initGhostingCron();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`notification-service on :${PORT}`);
});
