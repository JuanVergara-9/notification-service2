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
 * Envía un mensaje de texto al número indicado vía Meta WhatsApp Business API.
 * El número se normaliza quitando todo lo que no sea dígito (Meta espera solo números, sin +).
 *
 * @param {string} phoneNumber - Número en formato E.164 (ej. +5492604123456 o 5492604123456)
 * @param {string} body - Cuerpo del mensaje (texto plano)
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendWhatsAppText(phoneNumber, body) {
    if (!token || !phoneNumberId) {
        return { success: false, error: 'META_WA_TOKEN or META_WA_PHONE_NUMBER_ID not configured' };
    }

    // Meta espera "to" solo con dígitos (código país + número, sin + ni espacios).
    let to = String(phoneNumber).replace(/\D/g, '');
    if (!to) {
        return { success: false, error: 'Invalid phone number' };
    }

    // Normalización de prefijos argentinos: Meta Allowed List usa '54', pero webhooks envían '549'.
    if (to.startsWith('549')) {
        to = '54' + to.slice(3);
    }

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

    let to = String(phoneNumber).replace(/\D/g, '');

    // Normalización de prefijos argentinos: Meta Allowed List usa '54', pero webhooks envían '549'.
    if (to.startsWith('549')) {
        to = '54' + to.slice(3);
    }
    
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

module.exports = { sendWhatsAppText, sendTermsInteractiveMessage, sendMatchResultsMessage };
