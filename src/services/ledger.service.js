'use strict';

const { getPendingAmountTicketByProviderPhone, updateTicketFinalAmount, normalizePhoneForLedger } = require('./db.service');
const { sendWhatsAppText } = require('./whatsapp.service');

const MSG_ASK_AMOUNT = 'Por favor, respondeme solo con el número del monto que cobraste (ej: 15000).';
const MSG_CONFIRM_TEMPLATE = (amount) => `¡Excelente! 💸 Ya registramos tu ingreso de $${amount}. Esto te ayuda a construir tu historial financiero en miservicio. ¡A seguir creciendo!`;

/**
 * Comprueba si el mensaje es la respuesta de un profesional con el monto cobrado (GMV)
 * y, en ese caso, actualiza el Shadow Ledger y envía confirmación por WhatsApp.
 * Retorna true si se interceptó y procesó (no debe pasar a Gemini); false en caso contrario.
 *
 * @param {string} phoneNumber - Número de teléfono del remitente (from del webhook).
 * @param {string} messageText - Texto del mensaje.
 * @returns {Promise<boolean>}
 */
async function checkAndProcessProviderAmount(phoneNumber, messageText) {
    if (!phoneNumber || typeof messageText !== 'string') return false;

    const normalized = normalizePhoneForLedger(phoneNumber);
    if (!normalized) return false;

    // Paso A + B: Ticket pendiente de cobro para este profesional
    const ticket = await getPendingAmountTicketByProviderPhone(normalized);
    if (!ticket) return false;

    const text = messageText.trim();

    // Paso C: Extracción del número (regex)
    const numbers = text.match(/\d+/g);
    if (!numbers || numbers.length === 0) {
        await sendWhatsAppText(phoneNumber, MSG_ASK_AMOUNT);
        return true;
    }

    // Permitir monto con decimales: "15000" o "15000.50" o "15.000,50"
    const decimalMatch = text.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)/);
    const amountStr = decimalMatch ? decimalMatch[1] : numbers.join('');
    const amount = parseFloat(amountStr);
    if (Number.isNaN(amount) || amount <= 0) {
        await sendWhatsAppText(phoneNumber, MSG_ASK_AMOUNT);
        return true;
    }

    // Paso D: Actualizar Shadow Ledger
    const updated = await updateTicketFinalAmount(ticket.id, amount);
    if (!updated) {
        return true; // ya procesado o error; no pasar a Gemini
    }

    // Paso E: Confirmación por WhatsApp al profesional
    const formattedAmount = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
    await sendWhatsAppText(phoneNumber, MSG_CONFIRM_TEMPLATE(formattedAmount));

    console.log('[Ledger] GMV registrado.', { ticketId: ticket.id, amount: formattedAmount, providerPhone: normalized });
    return true;
}

module.exports = { checkAndProcessProviderAmount };
