'use strict';

const fs = require('fs');
if (fs.existsSync('.env.local')) {
    require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3005;

app.set('trust proxy', 1);
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan('short'));

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'notification-service' }));
app.get('/readyz', (_req, res) => res.json({ ok: true }));

// Rutas bajo /api/v1/notifications para que el gateway pueda proxy sin reescribir path
app.use('/api/v1/notifications', require('./routes/notification.routes'));
app.use('/api/v1', require('./routes/ticket.routes'));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`notification-service on :${PORT}`);
});
