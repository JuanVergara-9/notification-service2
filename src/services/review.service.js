'use strict';

const { getPendingReviewTicketByClientPhone, updateTicketClientRating, normalizePhoneForLedger } = require('./db.service');
const { sendWhatsAppText } = require('./whatsapp.service');

const MSG_INVALID_RATING = 'Por favor, respondeme solo con un número del 1 al 5 para calificar el servicio.';
const MSG_THANKS_RATING = '¡Gracias por tu calificación! ⭐ Tus reseñas ayudan a construir una comunidad más confiable.';

/**
 * Interceptor de reseñas: si el mensaje es la respuesta del cliente con una calificación 1-5
 * para un ticket COMPLETADO con final_amount y sin client_rating, actualiza el ticket y confirma.
 * Retorna true si se interceptó (no debe pasar a Gemini); false si no aplica.
 *
 * @param {string} from - Número del remitente (webhook).
 * @param {string} text - Texto del mensaje.
 * @returns {Promise<boolean>}
 */
async function checkAndProcessClientReview(from, text) {
    if (!from || typeof text !== 'string') return false;

    const normalized = normalizePhoneForLedger(from);
    if (!normalized) return false;

    const ticket = await getPendingReviewTicketByClientPhone(normalized);
    if (!ticket) return false;

    const trimmed = text.trim();
    const match = trimmed.match(/[1-5]/);
    if (!match) {
        await sendWhatsAppText(from, MSG_INVALID_RATING);
        return true;
    }

    const rating = parseInt(match[0], 10);
    await updateTicketClientRating(ticket.id, rating);
    await sendWhatsAppText(from, MSG_THANKS_RATING);

    console.log('[Review] Calificación registrada.', { ticketId: ticket.id, clientRating: rating, clientPhone: normalized });
    return true;
}

module.exports = { checkAndProcessClientReview };
