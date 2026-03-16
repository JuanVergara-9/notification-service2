'use strict';

const router = require('express').Router();
const { getShadowLedgerHealth, getBehavioralSignals } = require('../controllers/metrics.controller');

/**
 * GET /api/v1/metrics/shadow-ledger-health
 * Métricas del Shadow Ledger (últimos 30 días): activeWorkers, totalTransactions, gmv, retentionRate.
 */
router.get('/shadow-ledger-health', getShadowLedgerHealth);

/**
 * GET /api/v1/metrics/behavioral-signals
 * Señales de comportamiento agregadas (últimos 30 días).
 */
router.get('/behavioral-signals', getBehavioralSignals);

module.exports = router;
