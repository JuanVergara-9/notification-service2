'use strict';

/**
 * Servicio de envío de mensajes por WhatsApp usando la API Cloud de Meta (WhatsApp Business).
 * Requiere en .env: META_WA_TOKEN (token de acceso) y META_WA_PHONE_NUMBER_ID (ID del número de negocio).
 * Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const axios = require('axios');

// Base de la API de Graph (Meta); v18.0 es la versión usada para mensajes.
const META_GRAPH_BASE = 'https://graph.facebook.com/v18.0';
const token = process.env.META_WA_TOKEN;
const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://miservicio.ar';

/**
 * Normaliza números de teléfono argentinos para enviar a la API de WhatsApp.
 * @param {string|number} phone - Número en cualquier formato (local, 54..., 549..., etc.)
 * @returns {string|null} Número limpio (ej. 5492604123456) o null si no hay número.
 */
function formatWhatsAppNumber(phone) {
    if (!phone) return null;

    let cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
    }
    if (cleaned.startsWith('549') && cleaned.length === 13) {
        return cleaned;
    }
    if (cleaned.startsWith('54') && cleaned.length === 12) {
        return '549' + cleaned.substring(2);
    }
    if (cleaned.length === 10) {
        return '549' + cleaned;
    }
    return cleaned;
}

/**
 * Envía un mensaje de texto al número indicado vía Meta WhatsApp Business API.
 * El número se normaliza con formatWhatsAppNumber antes de enviar.
 *
 * @param {string} phoneNumber - Número en formato E.164 (ej. +5492604123456 o 5492604123456)
 * @param {string} body - Cuerpo del mensaje (texto plano)
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendWhatsAppText(phoneNumber, body) {
    if (!token || !phoneNumberId) {
        return { success: false, error: 'META_WA_TOKEN or META_WA_PHONE_NUMBER_ID not configured' };
    }

    const formattedPhone = formatWhatsAppNumber(phoneNumber);
    if (!formattedPhone) {
        return { success: false, error: 'Invalid phone number' };
    }

    // Meta Allowed List puede esperar 54 sin 9; se envía formateado y se ajusta si hace falta.
    const to = formattedPhone.startsWith('549') ? '54' + formattedPhone.slice(3) : formattedPhone;

    try {
        const url = `${META_GRAPH_BASE}/${phoneNumberId}/messages`;
        const { data } = await axios.post(
            url,
            {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body }
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15_000
            }
        );
        const messageId = data?.messages?.[0]?.id;
        return { success: true, messageId };
    } catch (err) {
        const message = err.response?.data?.error?.message || err.message;
        console.error('[WhatsApp] send error:', message);
        return { success: false, error: message };
    }
}

/**
 * Envía un mensaje interactivo con botones para la aceptación de Términos y Condiciones.
 * @param {string} phoneNumber - Número del destinatario.
 */
async function sendTermsInteractiveMessage(phoneNumber) {
    if (!token || !phoneNumberId) {
        return { success: false, error: 'META_WA_TOKEN or META_WA_PHONE_NUMBER_ID not configured' };
    }

    const formattedPhone = formatWhatsAppNumber(phoneNumber);
    if (!formattedPhone) {
        return { success: false, error: 'Invalid phone number' };
    }
    const to = formattedPhone.startsWith('549') ? '54' + formattedPhone.slice(3) : formattedPhone;

    try {
        const url = `${META_GRAPH_BASE}/${phoneNumberId}/messages`;
        const { data } = await axios.post(
            url,
            {
                messaging_product: "whatsapp",
                to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: { 
                        text: "¡Hola! Para conectarte con los mejores profesionales, por favor confirmá que aceptás nuestros nuevos Términos y Políticas actualizados (v1.1): www.miservicio.ar/legal" 
                    },
                    action: {
                        buttons: [
                            { "type": "reply", "reply": { "id": "accept_terms", "title": "✅ Acepto" } },
                            { "type": "reply", "reply": { "id": "reject_terms", "title": "❌ Cancelar" } }
                        ]
                    }
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15_000
            }
        );
        return { success: true, messageId: data?.messages?.[0]?.id };
    } catch (err) {
        const message = err.response?.data?.error?.message || err.message;
        console.error('[WhatsApp] interactive send error:', message);
        return { success: false, error: message };
    }
}

/**
 * Envía un mensaje con los resultados del matchmaking y el link al frontend.
 * @param {string} phoneNumber - Número del destinatario.
 * @param {number} matchCount - Cantidad de profesionales encontrados.
 * @param {number|string} ticketId - ID del ticket creado.
 */
async function sendMatchResultsMessage(phoneNumber, matchCount, ticketId) {
    const message = `¡Buenas noticias! 🚀 Encontré ${matchCount} profesionales disponibles para tu pedido.\n\nTocá el siguiente enlace para ver sus perfiles, reputación y elegir al que más te guste:\n${FRONTEND_URL}/pedidos/match/${ticketId}\n\n¡Avisame por acá cuando hayas elegido!`;
    
    // Meta API Cloud previsualiza enlaces automáticamente si el mensaje es de texto simple
    return sendWhatsAppText(phoneNumber, message);
}

/**
 * Envía al cliente el mensaje interactivo anti-ghosting (¿ya te contactó el profesional?).
 * @param {string} phoneNumber - Número del cliente (ticket.phone_number).
 * @param {number|string} ticketId - ID del ticket (para payloads de botones).
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendGhostCheckInteractiveMessage(phoneNumber, ticketId) {
    if (!token || !phoneNumberId) {
        return { success: false, error: 'META_WA_TOKEN or META_WA_PHONE_NUMBER_ID not configured' };
    }

    const formattedPhone = formatWhatsAppNumber(phoneNumber);
    if (!formattedPhone) return { success: false, error: 'Invalid phone number' };
    const to = formattedPhone.startsWith('549') ? '54' + formattedPhone.slice(3) : formattedPhone;

    const idYes = `GHOST_YES_${ticketId}`;
    const idNo = `GHOST_NO_${ticketId}`;

    try {
        const url = `${META_GRAPH_BASE}/${phoneNumberId}/messages`;
        const { data } = await axios.post(
            url,
            {
                messaging_product: 'whatsapp',
                to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: {
                        text: '¡Hola de nuevo! 😊 Pasó media hora desde que elegiste a tu profesional. ¿Ya se puso en contacto con vos?'
                    },
                    action: {
                        buttons: [
                            { type: 'reply', reply: { id: idYes, title: '✅ Sí, ya hablamos' } },
                            { type: 'reply', reply: { id: idNo, title: '❌ No, todavía no' } }
                        ]
                    }
                }
            },
            {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                timeout: 15_000
            }
        );
        return { success: true, messageId: data?.messages?.[0]?.id };
    } catch (err) {
        const message = err.response?.data?.error?.message || err.message;
        console.error('[WhatsApp] ghost check interactive send error:', message);
        return { success: false, error: message };
    }
}

/**
 * Envía el follow-up post-contacto directo al cliente.
 * @param {string} phoneNumber  - Teléfono del cliente.
 * @param {object} opts
 * @param {string} opts.clientName   - Nombre del cliente.
 * @param {string} opts.providerName - Nombre del proveedor.
 * @param {string} opts.category     - Categoría del servicio.
 * @param {string} opts.description  - Descripción escrita por el cliente al contactar.
 * @param {number} opts.days         - Días desde que realizó el contacto.
 * @param {number} opts.attempt      - Número de intento (1, 2 o 3).
 */
async function sendDirectContactFollowup(phoneNumber, { clientName, providerName, category, description, days, attempt }) {
    const isRecontact = attempt > 1;
    const intro = isRecontact
        ? `Hola ${clientName}! Te escribimos de nuevo desde miservicio.`
        : `Hola ${clientName}! 👋`;

    const contextLine = isRecontact
        ? `¿Finalmente pudiste hacer el trabajo con ${providerName} para "${description}"?`
        : `Hace ${days} días contactaste a ${providerName} (${category}) por miservicio para "${description}". ¿Cómo resultó?`;

    const options = isRecontact
        ? `1️⃣ Sí, ya se realizó\n2️⃣ Seguimos coordinando\n3️⃣ Al final no nos pusimos de acuerdo\n\nRespondé con 1, 2 o 3. (Intento ${attempt} de 3)`
        : `1️⃣ Sí, el trabajo ya se realizó\n2️⃣ Todavía lo estamos coordinando\n3️⃣ No me contactó\n4️⃣ Al final no nos pusimos de acuerdo\n\nRespondé con 1, 2, 3 o 4.`;

    const body = `${intro}\n\n${contextLine}\n\n${options}`;
    return sendWhatsAppText(phoneNumber, body);
}

/**
 * Pregunta al cliente cuánto cobró el proveedor.
 * @param {string} phoneNumber
 * @param {string} providerName
 */
async function sendAmountQuestion(phoneNumber, providerName) {
    const body = `¡Qué bueno! 🙌\n\n¿Sabés cuánto cobró ${providerName}? Respondé solo el número en pesos (ej: 15000).\nSi preferís no decirlo, escribí "no".`;
    return sendWhatsAppText(phoneNumber, body);
}

/**
 * Envía el link para dejar reseña en la página (nunca se pide rating por WA).
 * @param {string} phoneNumber
 * @param {string} providerName
 * @param {number} providerId
 */
async function sendReviewLink(phoneNumber, providerName, providerId) {
    const link = `${FRONTEND_URL}/proveedores/${providerId}?review=1`;
    const body = `Si quedaste conforme con el trabajo, podés dejarle una reseña a ${providerName} desde la página. Le ayuda mucho a conseguir más clientes 💪\n\n👉 ${link}\n\n¡Gracias por usar miservicio!`;
    return sendWhatsAppText(phoneNumber, body);
}

/**
 * Cierre de conversación cuando el proveedor no contactó (ghosted).
 * @param {string} phoneNumber
 */
async function sendGhostedClosure(phoneNumber) {
    const body = `Qué pena, lo vamos a tener en cuenta. Gracias por avisarnos.\n\nSi en algún momento necesitás otro profesional, encontralo en ${FRONTEND_URL} 👋`;
    return sendWhatsAppText(phoneNumber, body);
}

/**
 * Cierre de conversación cuando no hubo acuerdo.
 * @param {string} phoneNumber
 * @param {string} category
 */
async function sendNoAgreementClosure(phoneNumber, category) {
    const body = `Entendido. Gracias por contarnos.\n\nSi necesitás buscar otra opción, en ${FRONTEND_URL} podés ver más profesionales de ${category} en tu zona 🔍`;
    return sendWhatsAppText(phoneNumber, body);
}

module.exports = {
    formatWhatsAppNumber,
    sendWhatsAppText,
    sendTermsInteractiveMessage,
    sendMatchResultsMessage,
    sendGhostCheckInteractiveMessage,
    sendDirectContactFollowup,
    sendAmountQuestion,
    sendReviewLink,
    sendGhostedClosure,
    sendNoAgreementClosure,
};
