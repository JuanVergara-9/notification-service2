'use strict';

const axios = require('axios');
const { getPendingReviewTicketByClientPhone, updateTicketClientRating } = require('./db.service');
const { sendWhatsAppText } = require('./whatsapp.service');
const { generateInternalToken } = require('../utils/jwt');
const { emitCreditEvent } = require('./credit.service');

const MSG_INVALID_RATING = 'Por favor, respondeme solo con un número del 1 al 5 para calificar el servicio.';
const MSG_THANKS_RATING = '¡Gracias por tu calificación! ⭐ Tus reseñas ayudan a construir una comunidad más confiable.';

const REVIEWS_SERVICE_URL = (process.env.REVIEWS_SERVICE_URL || '').replace(/\/+$/, '');
const PROVIDER_SERVICE_URL = (process.env.PROVIDER_SERVICE_URL || '').replace(/\/+$/, '');

/**
 * Interceptor de reseñas: si el mensaje es la respuesta del cliente con una calificación 1-5
 * para un ticket COMPLETADO con final_amount y sin client_rating, actualiza el ticket y confirma.
 * Luego orquesta: guarda reseña en reviews-service y sincroniza CV Vivo en provider-service.
 * Retorna true si se interceptó (no debe pasar a Gemini); false si no aplica.
 *
 * @param {string} from - Número del remitente (webhook).
 * @param {string} text - Texto del mensaje.
 * @returns {Promise<boolean>}
 */
async function checkAndProcessClientReview(from, text) {
    if (!from || typeof text !== 'string') return false;

    const digits = String(from).replace(/\D/g, '');
    const phoneSuffix = digits.slice(-10);
    if (phoneSuffix.length !== 10) return false;

    const ticket = await getPendingReviewTicketByClientPhone(phoneSuffix);
    if (!ticket) return false;

    const trimmed = text.trim();
    const match = trimmed.match(/[1-5]/);
    if (!match) {
        await sendWhatsAppText(from, MSG_INVALID_RATING);
        return true;
    }

    const rating = parseInt(match[0], 10);
    await updateTicketClientRating(ticket.id, rating);

    try {
        const token = generateInternalToken();
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

        if (REVIEWS_SERVICE_URL && ticket.provider_id) {
            await axios.post(
                `${REVIEWS_SERVICE_URL}/api/v1/reviews`,
                {
                    providerId: ticket.provider_id,
                    ticketId: ticket.id,
                    rating,
                    source: 'whatsapp'
                },
                { headers, timeout: 10000 }
            );
        }
        if (PROVIDER_SERVICE_URL && ticket.provider_id) {
            await axios.post(
                `${PROVIDER_SERVICE_URL}/api/v1/providers/${ticket.provider_id}/sync-stats`,
                { newRating: rating, amountEarned: ticket.final_amount ?? 0 },
                { headers, timeout: 10000 }
            );
        }
    } catch (err) {
        console.error('[Review] Error orquestando reseña/CV Vivo (no se interrumpe el flujo):', err.message);
    }

    await sendWhatsAppText(from, MSG_THANKS_RATING);

    // Credit History: emit review event based on rating
    if (ticket.provider_id) {
        const eventType = rating >= 4 ? 'REVIEW_POSITIVE' : rating <= 2 ? 'REVIEW_NEGATIVE' : 'REVIEW_NEUTRAL';
        emitCreditEvent(ticket.provider_id, eventType, {
            metadata: { ticket_id: ticket.id, rating, source: 'whatsapp' },
            source: 'whatsapp'
        }).catch(err => console.error('[Credit] Error emitting review event:', err.message));
    }

    console.log('[Review] Calificación registrada.', { ticketId: ticket.id, clientRating: rating, clientSuffix: phoneSuffix });
    return true;
}

module.exports = { checkAndProcessClientReview };
