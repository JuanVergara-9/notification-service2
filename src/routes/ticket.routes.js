'use strict';

const router = require('express').Router();
const { saveTicket, getTickets, getTicketById, updateTicketStatus } = require('../services/db.service');

/**
 * GET /api/v1/tickets/:id
 * Obtiene un ticket por ID (Magic Link / página de selección de profesionales).
 */
router.get('/tickets/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const ticket = await getTicketById(id);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                error: 'Ticket no encontrado.'
            });
        }
        res.json({ success: true, data: ticket });
    } catch (err) {
        console.error('[Tickets API] Error al obtener ticket:', err.message);
        res.status(500).json({
            success: false,
            error: 'Error al obtener el ticket'
        });
    }
});

/**
 * GET /api/v1/tickets
 * Obtiene la lista de tickets (Dashboard Admin).
 */
router.get('/tickets', async (req, res) => {
    try {
        const tickets = await getTickets();
        res.json({
            success: true,
            data: tickets
        });
    } catch (err) {
        console.error('[Tickets API] Error al obtener tickets:', err.message);
        res.status(500).json({
            success: false,
            error: 'Error al obtener los tickets'
        });
    }
});

/**
 * PATCH /api/v1/tickets/:id/status
 * Actualiza el estado de un ticket.
 * Body: { status: 'NUEVO_ESTADO' }
 */
router.patch('/tickets/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'El campo status es requerido.'
            });
        }

        const updatedTicket = await updateTicketStatus(id, status);

        if (!updatedTicket) {
            return res.status(404).json({
                success: false,
                error: 'Ticket no encontrado.'
            });
        }

        res.json({
            success: true,
            data: updatedTicket
        });
    } catch (err) {
        console.error('[Tickets API] Error al actualizar ticket:', err.message);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar el ticket'
        });
    }
});

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
