'use strict';

const router = require('express').Router();
const { sendWhatsAppText } = require('../services/whatsapp.service');

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
