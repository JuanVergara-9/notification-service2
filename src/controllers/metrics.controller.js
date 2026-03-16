'use strict';

const { getShadowLedgerHealthMetrics } = require('../services/db.service');

/**
 * GET Shadow Ledger Health (Nivel 1).
 * Devuelve métricas de los últimos 30 días: trabajadores activos, transacciones totales, GMV.
 * retentionRate se deja en null hasta tener data de cohortes.
 */
async function getShadowLedgerHealth(_req, res) {
    try {
        const metrics = await getShadowLedgerHealthMetrics();
        res.json({
            activeWorkers: metrics.activeWorkers,
            totalTransactions: metrics.totalTransactions,
            gmv: metrics.gmv,
            retentionRate: null
        });
    } catch (err) {
        console.error('[Metrics] getShadowLedgerHealth:', err.message);
        res.status(500).json({
            error: 'Error al obtener métricas del Shadow Ledger'
        });
    }
}

module.exports = { getShadowLedgerHealth };
