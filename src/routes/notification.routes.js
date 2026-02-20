'use strict';

const router = require('express').Router();
const { sendWhatsAppText } = require('../services/whatsapp.service');
const { analyzeMessage } = require('../services/ai.service');

const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || '';
const WEBHOOK_ALLOWED_NUMBER = process.env.WEBHOOK_ALLOWED_NUMBER || ''; // Número con código de país (ej. 5492604123456)

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

        // Normalizar número de Argentina (Meta envía 549, pero solemos usar 54 en la configuración)
        const normalizedFrom = from.startsWith('549') ? '54' + from.slice(3) : from;

        console.log('[Webhook] Mensaje recibido.', { from, normalizedFrom, textLength: text.length });

        const allowedNormalized = String(WEBHOOK_ALLOWED_NUMBER).replace(/\D/g, '');
        if (!allowedNormalized || normalizedFrom !== allowedNormalized) {
            console.log('[Webhook] Remitente no autorizado, no se procesa.', { normalizedFrom, allowedNormalized });
            return;
        }

        const result = await analyzeMessage(text);
        console.log('[Gemini] Análisis completado.', JSON.stringify(result));

        // Fase 2: Responder al usuario por WhatsApp
        if (result && !result.error) {
            const mensajeAEnviar = `¡Hola! Entendí tu pedido. Estoy buscando los mejores profesionales en ${result.category} para ayudarte con: ${result.description}.`;
            
            try {
                await sendWhatsAppText(from, mensajeAEnviar);
                console.log('[Webhook] Respuesta enviada a WhatsApp a:', from);
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
