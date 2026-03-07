'use strict';

const cron = require('node-cron');
const { getTicketsForGhostCheck, setGhostCheckSent } = require('../services/db.service');
const { sendGhostCheckInteractiveMessage } = require('../services/whatsapp.service');

/**
 * Tarea que corre cada 5 minutos: busca tickets ASIGNADOS con más de 30 min
 * sin ghost check enviado, envía el mensaje interactivo al cliente y marca ghost_check_sent.
 */
function runGhostCheckTask() {
    (async () => {
        try {
            const tickets = await getTicketsForGhostCheck();
            if (tickets.length === 0) return;

            for (const ticket of tickets) {
                const clientPhone = ticket.phone_number;
                const result = await sendGhostCheckInteractiveMessage(clientPhone, ticket.id);
                if (result.success) {
                    await setGhostCheckSent(ticket.id);
                    console.log('[GhostCron] Ghost check enviado al cliente.', { ticketId: ticket.id, to: clientPhone });
                } else {
                    console.error('[GhostCron] Error enviando ghost check:', result.error, { ticketId: ticket.id });
                }
            }
        } catch (err) {
            console.error('[GhostCron] Error en tarea:', err.message);
        }
    })();
}

/**
 * Inicializa el cron del protocolo anti-ghosting: cada 5 minutos.
 */
function initGhostingCron() {
    cron.schedule('*/5 * * * *', runGhostCheckTask);
    console.log('[GhostCron] Cron anti-ghosting iniciado (cada 5 minutos).');
}

module.exports = { initGhostingCron, runGhostCheckTask };
