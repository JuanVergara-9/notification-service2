'use strict';

const router = require('express').Router();
const { saveTicket } = require('../services/db.service');

/**
 * POST /api/v1/tickets
 * Endpoint para crear tickets desde la plataforma web.
 * Body: { phone_number, category, description, zone, urgency }
 */
router.post('/tickets', async (req, res) => {
    try {
        const { phone_number, category, description, zone, urgency } = req.body;

        // Validación básica
        if (!phone_number || !category || !description) {
            return res.status(400).json({
                success: false,
                error: 'Faltan campos obligatorios: phone_number, category y description son requeridos.'
            });
        }

        const ticketData = { category, description, zone, urgency };
        
        // Guardar ticket con origen 'web'
        const ticketId = await saveTicket(phone_number, ticketData, 'web');

        res.status(201).json({
            success: true,
            message: 'Ticket creado con éxito desde la web',
            ticketId
        });
    } catch (err) {
        console.error('[Tickets API] Error al crear ticket:', err.message);
        res.status(500).json({
            success: false,
            error: 'Error interno al procesar el ticket'
        });
    }
});

module.exports = router;
