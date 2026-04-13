'use strict';

const router = require('express').Router();
const { formatWhatsAppNumber, sendWhatsAppText, sendTermsInteractiveMessage, sendMatchResultsMessage } = require('../services/whatsapp.service');
const { analyzeMessage } = require('../services/ai.service');
const { saveTicket, getUser, createUser, acceptTerms, CURRENT_TERMS_VERSION, getTicketById, reopenTicketAfterGhost } = require('../services/db.service');
const { findMatchingProviders } = require('../services/matchmaking.service');
const { checkAndProcessProviderAmount } = require('../services/ledger.service');
const { checkAndProcessClientReview } = require('../services/review.service');
const { getProviderWhatsAppNumber } = require('../services/provider-client.service');
const { whatsappLimiter } = require('../middlewares/whatsappLimiter.middleware');

const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || '';
const DEBOUNCE_MS = 2_000;
const messageBuffers = new Map();
const messageTimers = new Map();
const inFlightUsers = new Set();

function enqueueDebouncedMessage(from, text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
        return;
    }

    const currentBuffer = messageBuffers.get(from);
    const nextBuffer = currentBuffer ? `${currentBuffer}\n${text}` : text;
    messageBuffers.set(from, nextBuffer);

    const activeTimer = messageTimers.get(from);
    if (activeTimer) {
        clearTimeout(activeTimer);
    }

    const timer = setTimeout(() => {
        messageTimers.delete(from);
        flushBufferedMessages(from).catch((err) => {
            console.error('[Debounce] Error al procesar buffer:', err.message);
        });
    }, DEBOUNCE_MS);
    messageTimers.set(from, timer);
}

async function flushBufferedMessages(from) {
    if (inFlightUsers.has(from)) {
        return;
    }

    const fullText = messageBuffers.get(from);
    if (!fullText) {
        return;
    }

    messageBuffers.delete(from);
    inFlightUsers.add(from);

    try {
        const result = await analyzeMessage(from, fullText);
        console.log('[Gemini] Análisis completado.', JSON.stringify(result));

        // Fase 3.2: Persistencia en PostgreSQL si el ticket está completo
        if (result && result.isComplete && result.extractedData) {
            try {
                console.log('[Webhook] Ticket completo detectado, guardando en DB...');
                const ticketId = await saveTicket(from, result.extractedData, 'whatsapp');

                // --- NUEVO: Motor de Matchmaking ---
                console.log('[Webhook] Iniciando Matchmaking...');
                const matches = await findMatchingProviders(result.extractedData, ticketId);
                
                // Normalización definitiva para Argentina: Meta API Cloud rechaza el '9' en envíos
                const metaRecipient = from.startsWith('549') ? '54' + from.slice(3) : from;

                if (matches && matches.length > 0) {
                    console.log(`[Matchmaking] ¡Éxito! Se encontraron ${matches.length} profesionales:`, 
                        matches.map(m => `${m.name} (${m.is_pro ? 'PRO' : 'Normal'})`).join(', ')
                    );
                    
                    // Enviar el Magic Link al usuario
                    await sendMatchResultsMessage(metaRecipient, matches.length, ticketId);
                    console.log('[Webhook] Magic Link enviado a WhatsApp.');
                    return; // Importante: No enviar la respuesta genérica de Gemini si ya enviamos el link
                } else {
                    console.log('[Matchmaking] No se encontraron profesionales que coincidan exactamente.');
                    const noMatchesMsg = "Perdón, por el momento no tenemos profesionales verificados disponibles para ese rubro en tu zona.";
                    await sendWhatsAppText(metaRecipient, noMatchesMsg);
                    return; // No enviar respuesta genérica
                }
                // --- FIN Matchmaking ---

            } catch (dbErr) {
                console.error('[Webhook] Error en persistencia o matchmaking:', dbErr.message);
            }
        }

        // Fase 2: Responder al usuario por WhatsApp
        if (result && !result.error && result.replyToClient) {
            const mensajeAEnviar = result.replyToClient;
            
            try {
                // Normalización definitiva para Argentina: Meta API Cloud rechaza el '9' en envíos
                const metaRecipient = from.startsWith('549') ? '54' + from.slice(3) : from;
                
                await sendWhatsAppText(metaRecipient, mensajeAEnviar);
                console.log('[Webhook] Respuesta enviada a WhatsApp a:', metaRecipient);
            } catch (sendErr) {
                console.error('[Webhook] Error enviando respuesta a WhatsApp:', sendErr.message);
            }
        }
    } finally {
        inFlightUsers.delete(from);
        if (messageBuffers.has(from) && !messageTimers.has(from)) {
            const timer = setTimeout(() => {
                messageTimers.delete(from);
                flushBufferedMessages(from).catch((err) => {
                    console.error('[Debounce] Error al reprocesar buffer:', err.message);
                });
            }, DEBOUNCE_MS);
            messageTimers.set(from, timer);
        }
    }
}

/**
 * GET /webhook - Verificación del webhook por Meta (WhatsApp Business API).
 * Meta envía hub.mode, hub.verify_token, hub.challenge. Validamos el token y devolvemos el challenge.
 */
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        console.log('[Webhook] Verificación exitosa.');
        return res.status(200).send(challenge);
    }
    console.log('[Webhook] Verificación rechazada (token inválido o modo incorrecto).');
    res.status(403).send('Forbidden');
});

/**
 * POST /webhook - Recepción de mensajes entrantes de WhatsApp.
 * Acepta mensajes de cualquier número; el remitente se normaliza con formatWhatsAppNumber (549...) para la base de datos.
 */
router.post('/webhook', whatsappLimiter, async (req, res) => {
    // Meta exige respuesta 200 rápido; procesamos después
    res.sendStatus(200);

    try {
        const body = req.body;
        const value = body?.entry?.[0]?.changes?.[0]?.value;
        const messages = value?.messages;
        if (!messages || messages.length === 0) {
            return;
        }

        const first = messages[0];
        const from = formatWhatsAppNumber(first.from) || first.from;
        const text = (first.type === 'text' && first.text?.body) ? first.text.body : '';
        const interactive = first.type === 'interactive' ? first.interactive : null;

        console.log('[Webhook] Mensaje recibido.', { from, type: first.type });

        // --- Interceptor Shadow Ledger: captura respuesta del profesional con GMV (evita Gemini) ---
        if (first.type === 'text' && text) {
            const intercepted = await checkAndProcessProviderAmount(from, text);
            if (intercepted) {
                console.log('[Webhook] Mensaje interceptado por Ledger (GMV), no se envía a Gemini.');
                return;
            }
            // --- Interceptor de reseñas: captura calificación 1-5 del cliente (evita Gemini) ---
            const reviewIntercepted = await checkAndProcessClientReview(from, text);
            if (reviewIntercepted) {
                console.log('[Webhook] Mensaje interceptado por Review (calificación), no se envía a Gemini.');
                return;
            }
        }

        // --- Interceptor Anti-Ghosting (botones GHOST_YES_ / GHOST_NO_) ---
        if (interactive) {
            const buttonId = interactive.button_reply?.id || '';
            const metaRecipient = from.startsWith('549') ? '54' + from.slice(3) : from;

            if (buttonId.startsWith('GHOST_YES_')) {
                await sendWhatsAppText(metaRecipient, '¡Genial! Te dejo en buenas manos. ¡Avisame cuando terminen el trabajo!');
                console.log('[Webhook] Cliente confirmó contacto (GHOST_YES).', { from });
                return;
            }

            if (buttonId.startsWith('GHOST_NO_')) {
                const ticketId = buttonId.replace(/^GHOST_NO_/, '');
                const ticket = ticketId ? await getTicketById(ticketId) : null;
                if (ticket) {
                    await reopenTicketAfterGhost(ticketId);
                    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://miservicio.ar';
                    await sendWhatsAppText(metaRecipient, `Te pido mil disculpas. Evidentemente el profesional tuvo un contratiempo. Te vuelvo a mandar el enlace para que elijas a otra persona disponible: ${FRONTEND_URL}/pedidos/match/${ticketId}`);
                    const providerPhone = ticket.provider_phone || (ticket.provider_id ? await getProviderWhatsAppNumber(ticket.provider_id) : null);
                    if (providerPhone) {
                        await sendWhatsAppText(providerPhone, 'Hola. Como no contactaste al cliente a tiempo, el pedido fue devuelto a la bolsa de trabajo. Recordá que la rapidez es clave en miservicio.');
                    }
                    console.log('[Webhook] Ticket reabierto por ghosting (GHOST_NO).', { ticketId, from });
                }
                return;
            }
        }

        // --- FASE 3: Legal Gatekeeper Interceptor ---
        
        // 1. Manejo de respuestas interactivas (Botones)
        if (interactive) {
            const buttonId = interactive.button_reply?.id;
            
            if (buttonId === 'accept_terms') {
                await acceptTerms(from);
                await sendWhatsAppText(from, "¡Gracias! Ya estás registrado. ¿Qué servicio estás necesitando hoy?");
                return; // Corta el flujo
            }
            
            if (buttonId === 'reject_terms') {
                await sendWhatsAppText(from, "Entendemos. Para usar miservicio es necesario aceptar las políticas. ¡Te esperamos cuando gustes!");
                return; // Corta el flujo
            }
        }

        // 2. Verificación de Usuario y Términos para mensajes normales
        let user = await getUser(from);
        if (!user) {
            console.log('[Webhook] Usuario nuevo detectado, creando registro...', from);
            user = await createUser(from);
        }

        if (!user.terms_accepted || user.terms_version !== CURRENT_TERMS_VERSION) {
            console.log('[Webhook] Usuario sin términos aceptados o versión antigua, enviando gatekeeper...', { from, current: CURRENT_TERMS_VERSION, userVer: user.terms_version });
            await sendTermsInteractiveMessage(from);
            return; // Frena el flujo, NO pasa a Gemini
        }

        // --- FIN Legal Gatekeeper ---

        enqueueDebouncedMessage(from, text);
    } catch (err) {
        console.error('[Webhook] Error procesando POST:', err.message);
    }
});

/**
 * POST /send-whatsapp
 * Body: { phoneNumber, workerName, category }
 * Envía al trabajador un mensaje de nuevo interesado en su servicio.
 */
router.post('/send-whatsapp', async (req, res) => {
    try {
        const { phoneNumber, workerName, category } = req.body;
        if (!phoneNumber || !workerName || !category) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['phoneNumber', 'workerName', 'category']
            });
        }
        const message = `¡Hola ${workerName}! Tienes un nuevo interesado en tu servicio de ${category} en San Rafael. Entra a la app para ver los detalles.`;
        const result = await sendWhatsAppText(phoneNumber, message);
        if (!result.success) {
            return res.status(502).json({ error: 'WhatsApp send failed', detail: result.error });
        }
        res.json({ success: true, messageId: result.messageId });
    } catch (err) {
        console.error('[notification] POST /send-whatsapp:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
