'use strict';

const cron = require('node-cron');
const { recalculateAllActiveScores } = require('../services/credit.service');

function runCreditScoreRecalculation() {
    (async () => {
        try {
            console.log('[CreditCron] Starting daily score recalculation...');
            const result = await recalculateAllActiveScores();
            console.log(`[CreditCron] Done. Processed ${result.processed} providers.`);
        } catch (err) {
            console.error('[CreditCron] Error in recalculation task:', err.message);
        }
    })();
}

/**
 * Runs daily at 03:00 AM (Argentina time, low traffic).
 * Recalculates credit scores for all providers with recent events.
 */
function initCreditScoreCron() {
    cron.schedule('0 3 * * *', runCreditScoreRecalculation);
    console.log('[CreditCron] Credit score cron initialized (daily at 03:00).');
}

module.exports = { initCreditScoreCron, runCreditScoreRecalculation };
