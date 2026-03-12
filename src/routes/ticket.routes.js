'use strict';

const router = require('express').Router();
const { saveTicket, getTickets, getTicketById, updateTicketStatus, assignTicket, completeTicket } = require('../services/db.service');
const { sendWhatsAppText } = require('../services/whatsapp.service');
const { getProviderWhatsAppNumber } = require('../services/provider-client.service');

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
 * POST /api/v1/tickets/:id/assign
 * Asigna un ticket a un profesional. Actualiza status a ASIGNADO, guarda provider_id, provider_phone y notifica al cliente por WhatsApp.
 * Body: { providerId, providerName, providerPhone? }
 */
router.post('/tickets/:id/assign', async (req, res) => {
    try {
        const id = req.params.id;
        const { providerId, providerName, providerPhone } = req.body;

        if (!providerId || !providerName) {
            return res.status(400).json({
                success: false,
                error: 'providerId y providerName son requeridos.'
            });
        }

        const ticket = await getTicketById(id);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                error: 'Ticket no encontrado.'
            });
        }

        const updatedTicket = await assignTicket(id, providerId, providerName, providerPhone);
        if (!updatedTicket) {
            return res.status(500).json({
                success: false,
                error: 'Error al asignar el ticket.'
            });
        }

        const message = `¡Excelente elección! 🚀 Ya le avisé a ${providerName} sobre tu pedido. En los próximos minutos te va a escribir por acá para coordinar los detalles.`;
        await sendWhatsAppText(ticket.phone_number, message);

        res.json({
            success: true,
            data: updatedTicket,
            message: 'Ticket asignado y cliente notificado.'
        });
    } catch (err) {
        console.error('[Tickets API] Error al asignar ticket:', err.message);
        res.status(500).json({
            success: false,
            error: 'Error al asignar el ticket'
        });
    }
});

/**
 * POST /api/v1/tickets/:id/complete
 * Marca el ticket como COMPLETADO y envía al profesional un mensaje por WhatsApp
 * para solicitar el monto final (Shadow Ledger / GMV).
 */
const COMPLETE_MESSAGE_TO_PROVIDER = '¡Felicitaciones por completar el trabajo! 🎉 Para ir armando tu historial financiero en miservicio y destrabar beneficios, ¿cuál fue el monto final que le cobraste al cliente? (Respondeme solo con el número, ej: 15000)';

router.post('/tickets/:id/complete', async (req, res) => {
    try {
        const id = req.params.id;
        const ticket = await getTicketById(id);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                error: 'Ticket no encontrado.'
            });
        }
        if (ticket.status !== 'ASIGNADO') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden completar tickets en estado ASIGNADO.'
            });
        }
        if (!ticket.provider_id) {
            return res.status(400).json({
                success: false,
                error: 'El ticket no tiene profesional asignado.'
            });
        }

        const providerPhone = await getProviderWhatsAppNumber(ticket.provider_id);
        if (!providerPhone) {
            return res.status(400).json({
                success: false,
                error: 'No se pudo obtener el número de WhatsApp del profesional asignado.'
            });
        }

        const updatedTicket = await completeTicket(id, providerPhone);
        if (!updatedTicket) {
            return res.status(500).json({
                success: false,
                error: 'Error al marcar el ticket como completado.'
            });
        }

        await sendWhatsAppText(providerPhone, COMPLETE_MESSAGE_TO_PROVIDER);

        res.json({
            success: true,
            data: updatedTicket,
            message: 'Ticket marcado como completado y mensaje enviado al profesional.'
        });
    } catch (err) {
        console.error('[Tickets API] Error al completar ticket:', err.message);
        res.status(500).json({
            success: false,
            error: 'Error al completar el ticket'
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
