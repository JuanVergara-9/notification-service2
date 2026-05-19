'use strict';

const router = require('express').Router();
const { requireAdminJwt } = require('../middlewares/access.middleware');
const {
    getConversationsList,
    getChatLogsByPhone,
    setBotPaused,
    saveChatLog,
} = require('../services/db.service');
const { sendWhatsAppText } = require('../services/whatsapp.service');

// All routes require admin JWT
router.use(requireAdminJwt);

/**
 * GET /conversations
 * Lista de conversaciones únicas ordenadas por último mensaje.
 */
router.get('/conversations', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Number(req.query.offset) || 0;
        const conversations = await getConversationsList({ limit, offset });
        res.json({ conversations });
    } catch (err) {
        console.error('[AdminChat] GET /conversations error:', err.message);
        res.status(500).json({ error: 'Error al obtener conversaciones' });
    }
});

/**
 * GET /conversations/:phone/messages
 * Historial de mensajes de un número específico.
 */
router.get('/conversations/:phone/messages', async (req, res) => {
    try {
        const phone = req.params.phone;
        const limit = Math.min(Number(req.query.limit) || 200, 500);
        const offset = Number(req.query.offset) || 0;
        const messages = await getChatLogsByPhone(phone, { limit, offset });
        res.json({ messages });
    } catch (err) {
        console.error('[AdminChat] GET messages error:', err.message);
        res.status(500).json({ error: 'Error al obtener mensajes' });
    }
});

/**
 * POST /conversations/:phone/pause
 * Pausa el bot para un número (el admin toma control).
 */
router.post('/conversations/:phone/pause', async (req, res) => {
    try {
        const phone = req.params.phone;
        const paused = req.body.paused !== false;
        const user = await setBotPaused(phone, paused);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json({ phone, is_bot_paused: user.is_bot_paused });
    } catch (err) {
        console.error('[AdminChat] POST pause error:', err.message);
        res.status(500).json({ error: 'Error al cambiar pausa del bot' });
    }
});

/**
 * POST /conversations/:phone/send
 * El admin envía un mensaje al usuario vía WhatsApp.
 */
router.post('/conversations/:phone/send', async (req, res) => {
    try {
        const phone = req.params.phone;
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'El mensaje es requerido' });
        }

        const result = await sendWhatsAppText(phone, message.trim(), { skipLog: true });
        if (!result.success) {
            return res.status(502).json({ error: 'Error al enviar por WhatsApp', detail: result.error });
        }

        await saveChatLog(phone, 'ADMIN', message.trim());

        res.json({ success: true, messageId: result.messageId });
    } catch (err) {
        console.error('[AdminChat] POST send error:', err.message);
        res.status(500).json({ error: 'Error al enviar mensaje' });
    }
});

module.exports = router;
