'use strict';

const { getShadowLedgerHealthMetrics, getBehavioralMetrics, getIndividualWorkerScoring } = require('../services/db.service');

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

/**
 * GET Behavioral Signals (Nivel 1).
 * Devuelve métricas agregadas de comportamiento de los últimos 30 días.
 */
async function getBehavioralSignals(_req, res) {
    try {
        const metrics = await getBehavioralMetrics();
        res.json({
            avgResponseTimeMinutes: metrics.avgResponseTimeMinutes,
            ghostingRate: metrics.ghostingRate,
            punctualityRate: metrics.punctualityRate
        });
    } catch (err) {
        console.error('[Metrics] getBehavioralSignals:', err.message);
        res.status(500).json({
            error: 'Error al obtener señales de comportamiento'
        });
    }
}

/**
 * GET /api/v1/metrics/worker-scoring/:id
 * Perfil financiero / scoring crediticio individual de un trabajador.
 * Devuelve métricas transaccionales, de retención y de comportamiento.
 */
async function getWorkerFinancialProfile(req, res) {
    const providerId = req.params.id;
    if (!providerId || isNaN(Number(providerId))) {
        return res.status(400).json({ error: 'providerId inválido' });
    }
    try {
        const metrics = await getIndividualWorkerScoring(Number(providerId));
        res.json(metrics);
    } catch (err) {
        console.error('[Metrics] getWorkerFinancialProfile:', err.message);
        res.status(500).json({ error: 'Error al obtener el scoring del trabajador' });
    }
}

module.exports = { getShadowLedgerHealth, getBehavioralSignals, getWorkerFinancialProfile };
