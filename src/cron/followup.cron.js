'use strict';

const cron = require('node-cron');
const axios = require('axios');
const dayjs = require('dayjs');
const { generateInternalToken } = require('../utils/jwt');
const {
    sendDirectContactFollowup,
    sendAmountQuestion,
    sendReviewLink,
    sendGhostedClosure,
    sendNoAgreementClosure,
} = require('../services/whatsapp.service');
const { emitCreditEvent } = require('../services/credit.service');

const REVIEWS_SERVICE_URL = (process.env.REVIEWS_SERVICE_URL || '').replace(/\/+$/, '');

function internalHeaders() {
    const token = generateInternalToken();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Obtiene los contact_intents pendientes de follow-up desde reviews-service.
 */
async function fetchPendingFollowups() {
    if (!REVIEWS_SERVICE_URL) {
        console.warn('[FollowupCron] REVIEWS_SERVICE_URL no configurado, saltando.');
        return [];
    }
    const { data } = await axios.get(
        `${REVIEWS_SERVICE_URL}/api/v1/internal/contact-intents/pending-followup`,
        { headers: internalHeaders(), timeout: 10000 }
    );
    return data.items || [];
}

/**
 * Marca en reviews-service que el follow-up fue enviado.
 */
async function markSent(id) {
    await axios.patch(
        `${REVIEWS_SERVICE_URL}/api/v1/internal/contact-intents/${id}/followup-sent`,
        {},
        { headers: internalHeaders(), timeout: 10000 }
    );
}

/**
 * Procesa un único contact_intent: construye el mensaje y lo envía por WhatsApp.
 */
async function processFollowup(ci) {
    const phone = ci.client_phone;
    if (!phone) return;

    const clientName  = ci.client_name  || 'Cliente';
    const providerName = ci.provider_name || 'el profesional';
    const category    = ci.category     || 'el servicio';
    const description = ci.description  || 'tu consulta';
    const days        = dayjs().diff(dayjs(ci.created_at), 'day') || 3;
    const attempt     = (ci.followup_count || 0) + 1;

    const result = await sendDirectContactFollowup(phone, {
        clientName,
        providerName,
        category,
        description,
        days,
        attempt,
    });

    if (result.success) {
        await markSent(ci.id);
        console.log('[FollowupCron] Follow-up enviado.', { id: ci.id, attempt, to: phone });
    } else {
        console.error('[FollowupCron] Error enviando WA.', { id: ci.id, error: result.error });
    }
}

async function runFollowupTask() {
    try {
        const items = await fetchPendingFollowups();
        if (items.length === 0) return;

        console.log(`[FollowupCron] ${items.length} contact_intents para follow-up.`);
        for (const ci of items) {
            try {
                await processFollowup(ci);
            } catch (err) {
                console.error('[FollowupCron] Error procesando CI:', ci.id, err.message);
            }
        }
    } catch (err) {
        console.error('[FollowupCron] Error en tarea:', err.message);
    }
}

/**
 * Inicializa el cron de follow-ups: todos los días a las 10:00 AM.
 */
function initFollowupCron() {
    cron.schedule('0 10 * * *', runFollowupTask);
    console.log('[FollowupCron] Follow-up cron iniciado (diario a las 10:00).');
}

module.exports = { initFollowupCron, runFollowupTask, processFollowup };
