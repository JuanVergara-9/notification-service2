'use strict';

const router = require('express').Router();
const { getShadowLedgerHealth, getBehavioralSignals, getWorkerFinancialProfile, getActiveWorkers } = require('../controllers/metrics.controller');

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

/**
 * GET /api/v1/metrics/worker-scoring/:id
 * Scoring crediticio / perfil financiero individual de un trabajador.
 * Parámetro: id = provider_id del trabajador.
 * Retorna: totalCompletedJobs, totalGMV, ticketPromedio, daysSinceLastJob, ghostingRate, avgResponseTimeMinutes.
 */
router.get('/worker-scoring/:id', getWorkerFinancialProfile);

/**
 * GET /api/v1/metrics/active-workers
 * Lista de trabajadores activos (30d) con GMV y transacciones, para el dashboard general.
 */
router.get('/active-workers', getActiveWorkers);

module.exports = router;
