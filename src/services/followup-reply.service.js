'use strict';

/**
 * Interceptor de respuestas al follow-up de contacto directo.
 *
 * Máquina de estados:
 *   sent + "1" → completed  → pregunta monto → envía link reseña
 *   sent + "2" → coordinating (se reprograma en reviews-service)
 *   sent + "3" → ghosted   → JOB_GHOSTED credit event → cierre
 *   sent + "4" → no_agreement → cierre (no penaliza)
 *   completed (esperando monto) + número → guarda amount_paid → envía link reseña
 *   completed (esperando monto) + "no"   → envía link reseña directamente
 */

const axios = require('axios');
const { generateInternalToken } = require('../utils/jwt');
const { emitCreditEvent } = require('./credit.service');
const {
    sendAmountQuestion,
    sendReviewLink,
    sendGhostedClosure,
    sendNoAgreementClosure,
    sendWhatsAppText,
} = require('./whatsapp.service');

const REVIEWS_SERVICE_URL = (process.env.REVIEWS_SERVICE_URL || '').replace(/\/+$/, '');

// En memoria: cliente esperando respuesta de monto { phone → { ciId, providerId, providerName } }
const awaitingAmount = new Map();

function internalHeaders() {
    const token = generateInternalToken();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function getSentFollowup(phone) {
    if (!REVIEWS_SERVICE_URL) return null;
    try {
        const { data } = await axios.get(
            `${REVIEWS_SERVICE_URL}/api/v1/internal/contact-intents/sent-by-phone/${encodeURIComponent(phone)}`,
            { headers: internalHeaders(), timeout: 8000 }
        );
        return data.contactIntent || null;
    } catch { return null; }
}

async function patchAnswer(id, answer) {
    await axios.patch(
        `${REVIEWS_SERVICE_URL}/api/v1/internal/contact-intents/${id}/answer`,
        { answer },
        { headers: internalHeaders(), timeout: 8000 }
    );
}

async function patchAmount(id, amount) {
    await axios.patch(
        `${REVIEWS_SERVICE_URL}/api/v1/internal/contact-intents/${id}/amount`,
        { amount },
        { headers: internalHeaders(), timeout: 8000 }
    );
}

/**
 * @param {string} from  - Número normalizado (549...) del remitente.
 * @param {string} text  - Texto del mensaje.
 * @returns {Promise<boolean>} true si se interceptó, false si no aplica.
 */
async function checkAndProcessFollowupReply(from, text) {
    if (!from || typeof text !== 'string' || !REVIEWS_SERVICE_URL) return false;

    const trimmed = text.trim();

    // ── Fase 2: el cliente está en el flujo de "¿cuánto cobró?" ──────────────
    if (awaitingAmount.has(from)) {
        const { ciId, providerId, providerName } = awaitingAmount.get(from);
        awaitingAmount.delete(from);

        const noAmount = /^no$/i.test(trimmed);
        if (!noAmount) {
            const parsed = parseFloat(trimmed.replace(/\./g, '').replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) {
                await patchAmount(ciId, parsed).catch(() => {});
                // PAYMENT_REPORTED solo si hay providerId
                if (providerId) {
                    emitCreditEvent(providerId, 'PAYMENT_REPORTED', {
                        amount: parsed,
                        metadata: { contact_intent_id: ciId, source: 'direct_contact' },
                        source: 'direct_contact_followup',
                    }).catch(err => console.error('[Credit] PAYMENT_REPORTED error:', err.message));
                }
            }
        }

        if (providerId) {
            await sendReviewLink(from, providerName, providerId);
        }
        return true;
    }

    // ── Fase 1: respuesta al follow-up (1 / 2 / 3 / 4) ──────────────────────
    const validAnswers = ['1', '2', '3', '4'];
    if (!validAnswers.includes(trimmed)) return false;

    const ci = await getSentFollowup(from);
    if (!ci) return false;

    const providerId   = ci.provider_id   || null;
    const providerName = ci.provider_name || 'el profesional';
    const category     = ci.category      || 'el servicio';

    await patchAnswer(ci.id, trimmed).catch(err =>
        console.error('[FollowupReply] patchAnswer error:', err.message)
    );

    if (trimmed === '1') {
        // Trabajo completado → JOB_COMPLETED → preguntar monto
        if (providerId) {
            emitCreditEvent(providerId, 'JOB_COMPLETED', {
                metadata: { contact_intent_id: ci.id, source: 'direct_contact' },
                source: 'direct_contact_followup',
            }).catch(err => console.error('[Credit] JOB_COMPLETED error:', err.message));
        }
        awaitingAmount.set(from, { ciId: ci.id, providerId, providerName });
        await sendAmountQuestion(from, providerName);

    } else if (trimmed === '2') {
        // Todavía coordinando → solo acusar recibo, el cron se encarga del re-intento
        await sendWhatsAppText(from, `Perfecto, no hay problema. Cuando quieras podés dejarle una reseña a ${providerName} en miservicio.ar 👋`);

    } else if (trimmed === '3') {
        // Ghosted → JOB_GHOSTED credit event
        if (providerId) {
            emitCreditEvent(providerId, 'JOB_GHOSTED', {
                metadata: { contact_intent_id: ci.id, source: 'direct_contact' },
                source: 'direct_contact_followup',
            }).catch(err => console.error('[Credit] JOB_GHOSTED error:', err.message));
        }
        await sendGhostedClosure(from);

    } else if (trimmed === '4') {
        // Sin acuerdo → cerrar sin evento de crédito
        await sendNoAgreementClosure(from, category);
    }

    console.log('[FollowupReply] Respuesta procesada.', { ciId: ci.id, answer: trimmed, from });
    return true;
}

module.exports = { checkAndProcessFollowupReply };
