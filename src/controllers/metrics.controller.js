'use strict';

const { getShadowLedgerHealthMetrics, getBehavioralMetrics, getIndividualWorkerScoring, getActiveWorkersList, getCreditEventsByProvider, getCreditEventsCount, getCreditScoreHistory } = require('../services/db.service');
const { getCreditProfile, emitCreditEvent, calculateAndSaveScore, SCORE_WEIGHTS } = require('../services/credit.service');

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

/**
 * GET /api/v1/metrics/active-workers
 * Lista de trabajadores activos en los últimos 30 días con GMV y transacciones.
 */
async function getActiveWorkers(_req, res) {
    try {
        const workers = await getActiveWorkersList();
        res.json({ workers });
    } catch (err) {
        console.error('[Metrics] getActiveWorkers:', err.message);
        res.status(500).json({ error: 'Error al obtener lista de trabajadores' });
    }
}

/**
 * GET /api/v1/metrics/credit-history/:id
 * Timeline paginado de eventos crediticios de un trabajador.
 * Query params: limit (default 50), offset (default 0).
 */
async function getCreditHistory(req, res) {
    const providerId = Number(req.params.id);
    if (!providerId || isNaN(providerId)) {
        return res.status(400).json({ error: 'providerId inválido' });
    }
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Number(req.query.offset) || 0;

        const [events, total] = await Promise.all([
            getCreditEventsByProvider(providerId, { limit, offset }),
            getCreditEventsCount(providerId)
        ]);

        res.json({ events, total, limit, offset });
    } catch (err) {
        console.error('[Metrics] getCreditHistory:', err.message);
        res.status(500).json({ error: 'Error al obtener historial crediticio' });
    }
}

/**
 * GET /api/v1/metrics/credit-score/:id
 * Score crediticio actual + historial de snapshots + breakdown por dimensión.
 * Query params: history_limit (default 30) — cuántos snapshots traer.
 */
async function getCreditScore(req, res) {
    const providerId = Number(req.params.id);
    if (!providerId || isNaN(providerId)) {
        return res.status(400).json({ error: 'providerId inválido' });
    }
    try {
        const profile = await getCreditProfile(providerId);
        const historyLimit = Math.min(Number(req.query.history_limit) || 30, 90);
        const scoreHistory = await getCreditScoreHistory(providerId, { limit: historyLimit });

        res.json({
            current: {
                score: profile.score,
                level: profile.level,
                transactional_score: profile.transactional_score,
                behavioral_score: profile.behavioral_score,
                reputation_score: profile.reputation_score,
                financial_score: profile.financial_score,
                total_events: profile.total_events,
                calculated_at: profile.calculated_at
            },
            dimension_breakdown: profile.dimension_breakdown,
            recent_events: profile.recent_events,
            score_history: scoreHistory
        });
    } catch (err) {
        console.error('[Metrics] getCreditScore:', err.message);
        res.status(500).json({ error: 'Error al obtener score crediticio' });
    }
}

/**
 * POST /api/v1/internal/credit-events
 * Ingesta de eventos crediticios desde otros microservicios (provider-service, reviews-service).
 * Body: { provider_id, event_type, amount?, metadata?, source? }
 * Protected by x-internal-key header.
 */
async function ingestCreditEvent(req, res) {
    const internalKey = req.headers['x-internal-key'];
    const expectedKey = process.env.CREDIT_EVENTS_INTERNAL_KEY || process.env.JWT_SECRET || '';
    if (!internalKey || internalKey !== expectedKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { provider_id, event_type, amount, metadata, source } = req.body || {};
    if (!provider_id || !event_type) {
        return res.status(400).json({ error: 'provider_id and event_type are required' });
    }
    if (!SCORE_WEIGHTS[event_type]) {
        return res.status(400).json({ error: `Unknown event_type: ${event_type}` });
    }

    try {
        const event = await emitCreditEvent(Number(provider_id), event_type, {
            amount: amount != null ? Number(amount) : undefined,
            metadata,
            source: source || 'external'
        });
        res.status(201).json({ success: true, event });
    } catch (err) {
        console.error('[Metrics] ingestCreditEvent:', err.message);
        res.status(500).json({ error: 'Error al registrar evento crediticio' });
    }
}

/**
 * POST /api/v1/metrics/credit-score/:id/recalculate
 * Fuerza recálculo del score de un trabajador (admin/debug).
 */
async function recalculateCreditScore(req, res) {
    const providerId = Number(req.params.id);
    if (!providerId || isNaN(providerId)) {
        return res.status(400).json({ error: 'providerId inválido' });
    }
    try {
        const score = await calculateAndSaveScore(providerId);
        res.json({ success: true, score });
    } catch (err) {
        console.error('[Metrics] recalculateCreditScore:', err.message);
        res.status(500).json({ error: 'Error al recalcular score' });
    }
}

module.exports = {
    getShadowLedgerHealth,
    getBehavioralSignals,
    getWorkerFinancialProfile,
    getActiveWorkers,
    getCreditHistory,
    getCreditScore,
    ingestCreditEvent,
    recalculateCreditScore
};
