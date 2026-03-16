'use strict';

const router = require('express').Router();
const { getShadowLedgerHealth } = require('../controllers/metrics.controller');

/**
 * GET /api/v1/metrics/shadow-ledger-health
 * Métricas del Shadow Ledger (últimos 30 días): activeWorkers, totalTransactions, gmv, retentionRate.
 */
router.get('/shadow-ledger-health', getShadowLedgerHealth);

module.exports = router;
