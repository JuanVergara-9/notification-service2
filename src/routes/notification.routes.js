'use strict';

const router = require('express').Router();
const { sendWhatsAppText, sendTermsInteractiveMessage, sendMatchResultsMessage } = require('../services/whatsapp.service');
const { analyzeMessage } = require('../services/ai.service');
const { saveTicket, getUser, createUser, acceptTerms, CURRENT_TERMS_VERSION } = require('../services/db.service');
const { findMatchingProviders } = require('../services/matchmaking.service');

const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || '';
const WEBHOOK_ALLOWED_NUMBER = process.env.WEBHOOK_ALLOWED_NUMBER || ''; // Número con código de país (ej. 5492604800958)

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
 * Solo se procesa si el remitente está en la lista permitida (WEBHOOK_ALLOWED_NUMBER).
 */
router.post('/webhook', async (req, res) => {
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
        const from = first.from;
        const text = (first.type === 'text' && first.text?.body) ? first.text.body : '';
        const interactive = first.type === 'interactive' ? first.interactive : null;

        console.log('[Webhook] Mensaje recibido.', { from, type: first.type });

        if (!WEBHOOK_ALLOWED_NUMBER || from !== WEBHOOK_ALLOWED_NUMBER) {
            console.log('[Webhook] Remitente no autorizado, no se procesa.', { from, allowed: WEBHOOK_ALLOWED_NUMBER });
            return;
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

        const result = await analyzeMessage(from, text);
        console.log('[Gemini] Análisis completado.', JSON.stringify(result));

        // Fase 3.2: Persistencia en PostgreSQL si el ticket está completo
        if (result && result.isComplete && result.extractedData) {
            try {
                console.log('[Webhook] Ticket completo detectado, guardando en DB...');
                const ticketId = await saveTicket(from, result.extractedData, 'whatsapp');

                // --- NUEVO: Motor de Matchmaking ---
                console.log('[Webhook] Iniciando Matchmaking...');
                const matches = await findMatchingProviders(result.extractedData);
                
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
                    const noMatchesMsg = "Ya registré tu pedido, pero en este momento no tengo profesionales disponibles en esa zona. Lo dejo abierto y te aviso apenas se conecte uno.";
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
