'use strict';

const db = require('./db.service');

// ══════════════════════════════════════════════════════════════════════════════
// Score Weights – Configurable impact per event type.
// LEAD_DEBT starts soft (-3) to avoid blocking adoption in San Rafael;
// increase gradually as the market matures.
// ══════════════════════════════════════════════════════════════════════════════

const SCORE_WEIGHTS = {
    JOB_COMPLETED:      { category: 'transactional', impact: 10 },
    JOB_GHOSTED:        { category: 'behavioral',    impact: -15 },
    JOB_CANCELLED:      { category: 'behavioral',    impact: -5 },
    PAYMENT_REPORTED:   { category: 'financial',     impact: 5 },
    FAST_RESPONSE:      { category: 'behavioral',    impact: 3 },
    SLOW_RESPONSE:      { category: 'behavioral',    impact: -3 },
    REVIEW_POSITIVE:    { category: 'reputation',    impact: 5 },
    REVIEW_NEGATIVE:    { category: 'reputation',    impact: -8 },
    REVIEW_NEUTRAL:     { category: 'reputation',    impact: 1 },
    IDENTITY_VERIFIED:  { category: 'financial',     impact: 20 },
    LEAD_PAID:          { category: 'financial',     impact: 5 },
    LEAD_DEBT:          { category: 'financial',     impact: -3 },
    DEBT_PAID:          { category: 'financial',     impact: 8 },
    PRO_ACTIVATED:      { category: 'financial',     impact: 15 },
    CREDIT_PURCHASED:   { category: 'financial',     impact: 3 },
};

const SCORE_LEVELS = [
    { min: 0,   max: 200,  level: 'NUEVO' },
    { min: 201, max: 400,  level: 'EN_DESARROLLO' },
    { min: 401, max: 600,  level: 'CONFIABLE' },
    { min: 601, max: 800,  level: 'EXCELENTE' },
    { min: 801, max: 1000, level: 'ELITE' },
];

const MIN_SCORE = 0;
const MAX_SCORE = 1000;
const BASE_SCORE = 100;

function getLevel(score) {
    const entry = SCORE_LEVELS.find(l => score >= l.min && score <= l.max);
    return entry ? entry.level : 'NUEVO';
}

function clampScore(score) {
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

// ══════════════════════════════════════════════════════════════════════════════
// Event Emission – Fire-and-forget credit events from business flows.
// Each call is idempotent: duplicates are checked via metadata reference IDs.
// ══════════════════════════════════════════════════════════════════════════════

async function emitCreditEvent(providerId, eventType, { amount, metadata, source } = {}) {
    if (!providerId || !eventType) {
        console.warn('[Credit] emitCreditEvent called without providerId or eventType');
        return null;
    }

    const weight = SCORE_WEIGHTS[eventType];
    if (!weight) {
        console.warn(`[Credit] Unknown event type: ${eventType}`);
        return null;
    }

    const refId = metadata?.ticket_id || metadata?.order_id || metadata?.review_id;
    const refField = metadata?.ticket_id ? 'ticket_id' : metadata?.order_id ? 'order_id' : 'review_id';

    if (refId) {
        const isDuplicate = await db.checkDuplicateCreditEvent(providerId, eventType, refId, refField);
        if (isDuplicate) {
            console.log(`[Credit] Duplicate ${eventType} for provider ${providerId} (${refField}=${refId}), skipping.`);
            return null;
        }
    }

    try {
        const event = await db.insertCreditEvent(
            providerId,
            eventType,
            weight.category,
            weight.impact,
            { amount, metadata, source }
        );
        console.log(`[Credit] Event ${eventType} (${weight.impact > 0 ? '+' : ''}${weight.impact}) for provider ${providerId}`);
        return event;
    } catch (err) {
        console.error(`[Credit] Failed to emit ${eventType} for provider ${providerId}:`, err.message);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Score Calculation – Builds a score snapshot from all credit_events.
// Applies temporal decay: events older than 180 days count at 50%.
// ══════════════════════════════════════════════════════════════════════════════

const DECAY_THRESHOLD_DAYS = 180;
const DECAY_FACTOR = 0.5;

async function calculateAndSaveScore(providerId) {
    try {
        const events = await db.getCreditEventsByProvider(providerId, { limit: 10000, offset: 0 });

        if (events.length === 0) {
            return db.insertCreditScore(providerId, {
                score: BASE_SCORE,
                level: getLevel(BASE_SCORE),
                transactional_score: 0,
                behavioral_score: 0,
                reputation_score: 0,
                financial_score: 0,
                total_events: 0,
                metadata: { reason: 'no_events' }
            });
        }

        const now = Date.now();
        const dimensionTotals = { transactional: 0, behavioral: 0, reputation: 0, financial: 0 };
        const dimensionCounts = { transactional: 0, behavioral: 0, reputation: 0, financial: 0 };

        for (const evt of events) {
            const ageMs = now - new Date(evt.created_at).getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            const decay = ageDays > DECAY_THRESHOLD_DAYS ? DECAY_FACTOR : 1;
            const weightedImpact = evt.score_impact * decay;

            if (dimensionTotals[evt.category] !== undefined) {
                dimensionTotals[evt.category] += weightedImpact;
                dimensionCounts[evt.category]++;
            }
        }

        const rawScore = BASE_SCORE
            + dimensionTotals.transactional
            + dimensionTotals.behavioral
            + dimensionTotals.reputation
            + dimensionTotals.financial;

        const finalScore = clampScore(Math.round(rawScore));

        const scoreData = {
            score: finalScore,
            level: getLevel(finalScore),
            transactional_score: Math.round(dimensionTotals.transactional),
            behavioral_score: Math.round(dimensionTotals.behavioral),
            reputation_score: Math.round(dimensionTotals.reputation),
            financial_score: Math.round(dimensionTotals.financial),
            total_events: events.length,
            metadata: {
                base_score: BASE_SCORE,
                dimension_counts: dimensionCounts,
                decay_threshold_days: DECAY_THRESHOLD_DAYS
            }
        };

        const saved = await db.insertCreditScore(providerId, scoreData);
        console.log(`[Credit] Score calculated for provider ${providerId}: ${finalScore} (${scoreData.level})`);
        return saved;
    } catch (err) {
        console.error(`[Credit] Error calculating score for provider ${providerId}:`, err.message);
        throw err;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Batch recalculation – Called by cron to update scores for active providers.
// ══════════════════════════════════════════════════════════════════════════════

async function recalculateAllActiveScores() {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const providerIds = await db.getProvidersWithRecentEvents(oneDayAgo);

        if (providerIds.length === 0) {
            console.log('[Credit] No providers with recent events, skipping recalculation.');
            return { processed: 0 };
        }

        console.log(`[Credit] Recalculating scores for ${providerIds.length} providers...`);

        let processed = 0;
        for (const pid of providerIds) {
            try {
                await calculateAndSaveScore(pid);
                processed++;
            } catch (err) {
                console.error(`[Credit] Error recalculating score for provider ${pid}:`, err.message);
            }
        }

        console.log(`[Credit] Recalculation complete: ${processed}/${providerIds.length} providers updated.`);
        return { processed, total: providerIds.length };
    } catch (err) {
        console.error('[Credit] Error in batch recalculation:', err.message);
        throw err;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Query helpers for API layer
// ══════════════════════════════════════════════════════════════════════════════

async function getCreditProfile(providerId) {
    const [latestScore, summary, recentEvents] = await Promise.all([
        db.getLatestCreditScore(providerId),
        db.getCreditEventsSummaryByProvider(providerId),
        db.getCreditEventsByProvider(providerId, { limit: 20 }),
    ]);

    const dimensionBreakdown = {};
    for (const row of summary) {
        dimensionBreakdown[row.category] = {
            total_impact: row.total_impact,
            event_count: row.event_count
        };
    }

    return {
        score: latestScore?.score ?? BASE_SCORE,
        level: latestScore?.level ?? getLevel(BASE_SCORE),
        transactional_score: latestScore?.transactional_score ?? 0,
        behavioral_score: latestScore?.behavioral_score ?? 0,
        reputation_score: latestScore?.reputation_score ?? 0,
        financial_score: latestScore?.financial_score ?? 0,
        total_events: latestScore?.total_events ?? 0,
        calculated_at: latestScore?.calculated_at ?? null,
        dimension_breakdown: dimensionBreakdown,
        recent_events: recentEvents
    };
}

module.exports = {
    SCORE_WEIGHTS,
    SCORE_LEVELS,
    emitCreditEvent,
    calculateAndSaveScore,
    recalculateAllActiveScores,
    getCreditProfile,
    getLevel,
};
