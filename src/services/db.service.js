'use strict';

const { Pool } = require('pg');

/**
 * Configuración del Pool de conexiones a PostgreSQL.
 * Se utiliza DATABASE_URL proporcionada por Railway.
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Requerido para conexiones externas a Railway
    }
});

const CURRENT_TERMS_VERSION = 'v1.1';

/**
 * Script de inicialización: Crea las tablas si no existen.
 */
const initDB = async () => {
    const query = `
        CREATE TABLE IF NOT EXISTS tickets (
            id SERIAL PRIMARY KEY,
            phone_number VARCHAR(20) NOT NULL,
            category VARCHAR(100),
            description TEXT,
            zone VARCHAR(100),
            urgency VARCHAR(50),
            status VARCHAR(20) DEFAULT 'ABIERTO',
            source VARCHAR(20),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
            phone_number VARCHAR(50) PRIMARY KEY, 
            terms_accepted BOOLEAN DEFAULT false, 
            accepted_at TIMESTAMP, 
            terms_version VARCHAR(20)
        );
    `;
    try {
        await pool.query(query);
        console.log('[DB] Tablas "tickets" y "users" verificadas/creadas con éxito.');
        
        // Verificar si las columnas nuevas existen en tickets (por si la tabla ya estaba creada)
        const checkCols = `
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='status') THEN
                    ALTER TABLE tickets ADD COLUMN status VARCHAR(20) DEFAULT 'ABIERTO';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='source') THEN
                    ALTER TABLE tickets ADD COLUMN source VARCHAR(20);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='provider_id') THEN
                    ALTER TABLE tickets ADD COLUMN provider_id INTEGER;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='provider_name') THEN
                    ALTER TABLE tickets ADD COLUMN provider_name VARCHAR(200);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='final_amount') THEN
                    ALTER TABLE tickets ADD COLUMN final_amount NUMERIC(12, 2);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='provider_phone') THEN
                    ALTER TABLE tickets ADD COLUMN provider_phone VARCHAR(32);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='assigned_at') THEN
                    ALTER TABLE tickets ADD COLUMN assigned_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='ghost_check_sent') THEN
                    ALTER TABLE tickets ADD COLUMN ghost_check_sent BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='client_rating') THEN
                    ALTER TABLE tickets ADD COLUMN client_rating INTEGER;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='category_slug') THEN
                    ALTER TABLE tickets ADD COLUMN category_slug VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='provider_responded_at') THEN
                    ALTER TABLE tickets ADD COLUMN provider_responded_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='completed_at') THEN
                    ALTER TABLE tickets ADD COLUMN completed_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='amount_reported_at') THEN
                    ALTER TABLE tickets ADD COLUMN amount_reported_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='cancellation_reason') THEN
                    ALTER TABLE tickets ADD COLUMN cancellation_reason VARCHAR(255);
                END IF;
            END $$;
        `;
        await pool.query(checkCols);
    } catch (err) {
        console.error('[DB] Error al inicializar la tabla:', err.message);
    }
};

// Ejecutar inicialización al cargar el servicio
initDB();

/**
 * Obtiene un usuario por su número de teléfono.
 */
async function getUser(phone) {
    const query = 'SELECT * FROM users WHERE phone_number = $1;';
    try {
        const res = await pool.query(query, [phone]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al obtener usuario:', err.message);
        throw err;
    }
}

/**
 * Crea un usuario nuevo con términos no aceptados.
 */
async function createUser(phone) {
    const query = 'INSERT INTO users (phone_number, terms_accepted) VALUES ($1, false) ON CONFLICT DO NOTHING RETURNING *;';
    try {
        const res = await pool.query(query, [phone]);
        return res.rows[0];
    } catch (err) {
        console.error('[DB] Error al crear usuario:', err.message);
        throw err;
    }
}

/**
 * Registra la aceptación de términos y condiciones (Audit Trail Fintech).
 */
async function acceptTerms(phone) {
    const query = `
        UPDATE users 
        SET terms_accepted = true, 
            accepted_at = CURRENT_TIMESTAMP, 
            terms_version = $2 
        WHERE phone_number = $1 
        RETURNING *;
    `;
    try {
        const res = await pool.query(query, [phone, CURRENT_TERMS_VERSION]);
        console.log(`[DB] Términos aceptados para ${phone} (Versión: ${CURRENT_TERMS_VERSION})`);
        return res.rows[0];
    } catch (err) {
        console.error('[DB] Error al aceptar términos:', err.message);
        throw err;
    }
}

/**
 * Guarda un ticket en la base de datos.
 * @param {string} phone - Número de teléfono del remitente.
 * @param {object} ticketData - Datos extraídos por la IA o recibidos por la web.
 * @param {string} source - Origen del ticket ('whatsapp' o 'web').
 */
async function saveTicket(phone, ticketData, source) {
    const { category, description, zone, urgency } = ticketData;
    const query = `
        INSERT INTO tickets (phone_number, category, description, zone, urgency, source)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
    `;
    const values = [phone, category, description, zone, urgency, source];

    try {
        const res = await pool.query(query, values);
        console.log(`[DB] Ticket guardado con éxito (${source}). ID: ${res.rows[0].id}`);
        return res.rows[0].id;
    } catch (err) {
        console.error('[DB] Error al insertar ticket:', err.message);
        throw err;
    }
}

/**
 * Obtiene los últimos 100 tickets de la base de datos.
 * @returns {Promise<Array>} Lista de tickets.
 */
async function getTickets() {
    const query = `
        SELECT * FROM tickets 
        ORDER BY created_at DESC 
        LIMIT 100;
    `;
    try {
        const res = await pool.query(query);
        return res.rows;
    } catch (err) {
        console.error('[DB] Error al obtener tickets:', err.message);
        throw err;
    }
}

/**
 * Obtiene un ticket por ID (para Magic Link / página de match).
 * @param {number|string} id - ID del ticket.
 * @returns {Promise<object|null>} Ticket o null si no existe.
 */
async function getTicketById(id) {
    const query = 'SELECT * FROM tickets WHERE id = $1;';
    try {
        const res = await pool.query(query, [id]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al obtener ticket por ID:', err.message);
        throw err;
    }
}

/**
 * Actualiza el estado de un ticket.
 * Si newStatus es COMPLETADO, setea también completed_at = NOW() para scoring.
 * @param {number} id - ID del ticket.
 * @param {string} newStatus - Nuevo estado (ABIERTO, ASIGNADO, COMPLETADO, CANCELADO).
 */
async function updateTicketStatus(id, newStatus) {
    const isCompleted = (newStatus || '').toUpperCase() === 'COMPLETADO';
    const query = isCompleted
        ? 'UPDATE tickets SET status = $1, completed_at = NOW() WHERE id = $2 RETURNING *;'
        : 'UPDATE tickets SET status = $1 WHERE id = $2 RETURNING *;';
    try {
        const res = await pool.query(query, [newStatus, id]);
        return res.rows[0];
    } catch (err) {
        console.error('[DB] Error al actualizar estado del ticket:', err.message);
        throw err;
    }
}

/**
 * Asigna un ticket a un proveedor: actualiza status a ASIGNADO, guarda provider_id, provider_name, provider_phone y assigned_at = NOW().
 * @param {number|string} ticketId - ID del ticket.
 * @param {number|string} providerId - ID del proveedor asignado.
 * @param {string} providerName - Nombre del proveedor (para mostrar en dashboard).
 * @param {string} [providerPhone] - Teléfono WhatsApp del profesional (para anti-ghosting y reasignación).
 * @returns {Promise<object|null>} Ticket actualizado o null si no existe.
 */
async function assignTicket(ticketId, providerId, providerName, providerPhone) {
    const query = `UPDATE tickets SET status = $1, provider_id = $2, provider_name = $3, provider_phone = $4, assigned_at = NOW(), ghost_check_sent = false WHERE id = $5 RETURNING *;`;
    try {
        const res = await pool.query(query, ['ASIGNADO', providerId, providerName || null, providerPhone || null, ticketId]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al asignar ticket:', err.message);
        throw err;
    }
}

/**
 * Tickets ASIGNADOS con más de 30 minutos desde assigned_at y sin haber enviado ghost check.
 * @returns {Promise<Array>}
 */
async function getTicketsForGhostCheck() {
    const query = `
        SELECT * FROM tickets 
        WHERE status = 'ASIGNADO' 
          AND assigned_at IS NOT NULL 
          AND (ghost_check_sent = false OR ghost_check_sent IS NULL)
          AND assigned_at < NOW() - INTERVAL '30 minutes'
        ORDER BY assigned_at ASC;
    `;
    try {
        const res = await pool.query(query);
        return res.rows;
    } catch (err) {
        console.error('[DB] Error al obtener tickets para ghost check:', err.message);
        throw err;
    }
}

/**
 * Marca que ya se envió el mensaje de ghost check al cliente.
 * @param {number|string} ticketId
 * @returns {Promise<object|null>}
 */
async function setGhostCheckSent(ticketId) {
    const query = 'UPDATE tickets SET ghost_check_sent = true WHERE id = $1 RETURNING *;';
    try {
        const res = await pool.query(query, [ticketId]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al marcar ghost_check_sent:', err.message);
        throw err;
    }
}

/**
 * Reabre un ticket tras ghosting: vuelve a ABIERTO y limpia asignación.
 * @param {number|string} ticketId
 * @returns {Promise<object|null>}
 */
async function reopenTicketAfterGhost(ticketId) {
    const query = `UPDATE tickets 
        SET status = 'ABIERTO', provider_id = NULL, provider_name = NULL, provider_phone = NULL, assigned_at = NULL, ghost_check_sent = false 
        WHERE id = $1 RETURNING *;`;
    try {
        const res = await pool.query(query, [ticketId]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al reabrir ticket por ghosting:', err.message);
        throw err;
    }
}

/**
 * Marca un ticket como COMPLETADO y guarda el teléfono del profesional para el Shadow Ledger.
 * Setea completed_at = NOW() para scoring.
 * @param {number|string} ticketId - ID del ticket.
 * @param {string} providerPhone - Teléfono WhatsApp del profesional (E.164).
 * @returns {Promise<object|null>} Ticket actualizado o null.
 */
async function completeTicket(ticketId, providerPhone) {
    const query = 'UPDATE tickets SET status = $1, provider_phone = $2, completed_at = NOW() WHERE id = $3 RETURNING *;';
    try {
        const res = await pool.query(query, ['COMPLETADO', providerPhone || null, ticketId]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al completar ticket:', err.message);
        throw err;
    }
}

/**
 * Obtiene un ticket COMPLETADO con final_amount pendiente (NULL) cuyo provider_phone termina en los últimos 10 dígitos dados.
 * Inmune a prefijos de país y códigos de área.
 * @param {string} phoneSuffixLast10 - Últimos 10 dígitos del teléfono (solo dígitos, longitud 10).
 * @returns {Promise<object|null>} Ticket o null.
 */
async function getPendingAmountTicketByProviderPhone(phoneSuffixLast10) {
    const suffix = String(phoneSuffixLast10).replace(/\D/g, '').slice(-10);
    if (suffix.length !== 10) return null;

    const query = `
        SELECT * FROM tickets
        WHERE status = 'COMPLETADO' AND final_amount IS NULL AND provider_phone IS NOT NULL
          AND REGEXP_REPLACE(provider_phone, '[^0-9]', '', 'g') LIKE '%' || $1
        ORDER BY id DESC LIMIT 50;
    `;
    try {
        const res = await pool.query(query, [suffix]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al buscar ticket pendiente de monto:', err.message);
        throw err;
    }
}

/**
 * Actualiza el monto final (GMV) de un ticket. Setea amount_reported_at = NOW() para scoring (Shadow Ledger).
 * @param {number|string} ticketId - ID del ticket.
 * @param {number} amount - Monto a registrar.
 * @returns {Promise<object|null>} Ticket actualizado o null.
 */
async function updateTicketFinalAmount(ticketId, amount) {
    const query = 'UPDATE tickets SET final_amount = $1, amount_reported_at = NOW() WHERE id = $2 RETURNING *;';
    try {
        const res = await pool.query(query, [amount, ticketId]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al actualizar final_amount:', err.message);
        throw err;
    }
}

/** Normaliza teléfono para comparación (solo dígitos; Argentina 549 -> 54). */
function normalizePhoneForLedger(phone) {
    if (!phone) return '';
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('549')) digits = '54' + digits.slice(3);
    return digits;
}

/**
 * Obtiene un ticket COMPLETADO con final_amount y client_rating pendiente (NULL) cuyo phone_number termina en los últimos 10 dígitos dados.
 * Inmune a prefijos de país y códigos de área.
 * @param {string} phoneSuffixLast10 - Últimos 10 dígitos del teléfono del cliente (solo dígitos, longitud 10).
 * @returns {Promise<object|null>} Ticket o null.
 */
async function getPendingReviewTicketByClientPhone(phoneSuffixLast10) {
    const suffix = String(phoneSuffixLast10).replace(/\D/g, '').slice(-10);
    if (suffix.length !== 10) return null;

    const query = `
        SELECT * FROM tickets
        WHERE status = 'COMPLETADO' AND final_amount IS NOT NULL AND client_rating IS NULL
          AND REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') LIKE '%' || $1
        ORDER BY id DESC LIMIT 50;
    `;
    try {
        const res = await pool.query(query, [suffix]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al buscar ticket pendiente de reseña:', err.message);
        throw err;
    }
}

/**
 * Actualiza la calificación del cliente en un ticket.
 * @param {number|string} ticketId - ID del ticket.
 * @param {number} rating - Calificación 1-5.
 * @returns {Promise<object|null>} Ticket actualizado o null.
 */
async function updateTicketClientRating(ticketId, rating) {
    const query = 'UPDATE tickets SET client_rating = $1 WHERE id = $2 RETURNING *;';
    try {
        const res = await pool.query(query, [rating, ticketId]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al actualizar client_rating:', err.message);
        throw err;
    }
}

/**
 * Actualiza el slug de categoría normalizado del ticket (usado por matchmaking para sincronizar con el frontend).
 * @param {number|string} ticketId - ID del ticket.
 * @param {string} categorySlug - Slug oficial (ej. plomeria, electricidad).
 * @returns {Promise<object|null>} Ticket actualizado o null.
 */
async function updateTicketCategorySlug(ticketId, categorySlug) {
    const query = 'UPDATE tickets SET category_slug = $1 WHERE id = $2 RETURNING *;';
    try {
        const res = await pool.query(query, [categorySlug || null, ticketId]);
        return res.rows[0] || null;
    } catch (err) {
        console.error('[DB] Error al actualizar category_slug:', err.message);
        throw err;
    }
}

/**
 * Métricas de comportamiento (últimos 30 días).
 * Calculadas en memoria a partir de los tickets recientes.
 * @returns {Promise<{ avgResponseTimeMinutes: number | null, ghostingRate: number, punctualityRate: number }>}
 */
async function getBehavioralMetrics() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const query = `
        SELECT
            status,
            assigned_at,
            provider_responded_at,
            completed_at,
            amount_reported_at
        FROM tickets
        WHERE created_at >= $1
    `;

    try {
        const res = await pool.query(query, [thirtyDaysAgo]);
        const tickets = res.rows || [];

        // Avg Response Time (en minutos)
        const responseDiffs = tickets
            .filter(t => t.assigned_at && t.provider_responded_at)
            .map(t => {
                const assigned = new Date(t.assigned_at);
                const responded = new Date(t.provider_responded_at);
                const diffMinutes = (responded.getTime() - assigned.getTime()) / (1000 * 60);
                return diffMinutes;
            })
            .filter(d => Number.isFinite(d) && d >= 0);

        const avgResponseTimeMinutes =
            responseDiffs.length > 0
                ? Number(
                      (responseDiffs.reduce((sum, v) => sum + v, 0) / responseDiffs.length).toFixed(1)
                  )
                : null;

        // Ghosting Rate
        const ticketsWithAssigned = tickets.filter(t => t.assigned_at);
        const totalWithAssigned = ticketsWithAssigned.length;

        const ghostedCount = ticketsWithAssigned.filter(t => {
            const status = (t.status || '').toUpperCase();
            const isCancelled = status === 'CANCELADO';
            const neverResponded = !t.provider_responded_at;
            return isCancelled || neverResponded;
        }).length;

        const ghostingRate =
            totalWithAssigned > 0
                ? Number(((ghostedCount / totalWithAssigned) * 100).toFixed(1))
                : 0;

        // Reporting Punctuality
        const completedWithReport = tickets.filter(
            t => t.completed_at && t.amount_reported_at
        );
        const totalCompleted = completedWithReport.length;

        const punctualCount = completedWithReport.filter(t => {
            const completed = new Date(t.completed_at);
            const reported = new Date(t.amount_reported_at);
            const diffHours = (reported.getTime() - completed.getTime()) / (1000 * 60 * 60);
            return Number.isFinite(diffHours) && diffHours >= 0 && diffHours < 24;
        }).length;

        const punctualityRate =
            totalCompleted > 0
                ? Number(((punctualCount / totalCompleted) * 100).toFixed(1))
                : 0;

        return {
            avgResponseTimeMinutes,
            ghostingRate,
            punctualityRate
        };
    } catch (err) {
        console.error('[DB] Error en getBehavioralMetrics:', err.message);
        return {
            avgResponseTimeMinutes: null,
            ghostingRate: 0,
            punctualityRate: 0
        };
    }
}

/**
 * Métricas de salud del Shadow Ledger (últimos 30 días).
 * Tickets COMPLETADOS con completed_at >= thirtyDaysAgo.
 * @returns {Promise<{ activeWorkers: number, totalTransactions: number, gmv: number }>}
 */
async function getShadowLedgerHealthMetrics() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const query = `
        SELECT
            COUNT(*)::int AS total_transactions,
            COALESCE(SUM(final_amount), 0)::numeric AS gmv,
            COUNT(DISTINCT provider_id) FILTER (WHERE provider_id IS NOT NULL)::int AS active_workers
        FROM tickets
        WHERE status = 'COMPLETADO' AND completed_at >= $1
    `;
    try {
        const res = await pool.query(query, [thirtyDaysAgo]);
        const row = res.rows[0];
        return {
            activeWorkers: row?.active_workers ?? 0,
            totalTransactions: row?.total_transactions ?? 0,
            gmv: Number(row?.gmv ?? 0)
        };
    } catch (err) {
        console.error('[DB] Error en getShadowLedgerHealthMetrics:', err.message);
        throw err;
    }
}

/**
 * Scoring crediticio / perfil financiero individual de un trabajador.
 * Calcula métricas transaccionales, de retención y de comportamiento
 * a partir de todos los tickets asociados al providerId dado.
 *
 * @param {number|string} providerId
 * @returns {Promise<{
 *   totalCompletedJobs: number,
 *   totalGMV: number,
 *   ticketPromedio: number | null,
 *   daysSinceLastJob: number | null,
 *   ghostingRate: number,
 *   avgResponseTimeMinutes: number | null
 * }>}
 */
/**
 * Lista de trabajadores activos (últimos 30 días) con sus métricas básicas.
 * Usado para el listado del dashboard general (Nivel 1 → Nivel 2).
 * @returns {Promise<Array<{ provider_id, provider_name, total_transactions, gmv }>>}
 */
async function getActiveWorkersList() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const query = `
        SELECT
            provider_id,
            provider_name,
            COUNT(*)::int AS total_transactions,
            COALESCE(SUM(final_amount), 0)::numeric AS gmv
        FROM tickets
        WHERE status = 'COMPLETADO'
          AND completed_at >= $1
          AND provider_id IS NOT NULL
        GROUP BY provider_id, provider_name
        ORDER BY gmv DESC
    `;
    try {
        const res = await pool.query(query, [thirtyDaysAgo]);
        return res.rows.map(r => ({
            provider_id: r.provider_id,
            provider_name: r.provider_name || `Trabajador #${r.provider_id}`,
            total_transactions: r.total_transactions,
            gmv: Number(r.gmv)
        }));
    } catch (err) {
        console.error('[DB] Error en getActiveWorkersList:', err.message);
        throw err;
    }
}

async function getIndividualWorkerScoring(providerId) {
    const query = `
        SELECT
            status,
            final_amount,
            completed_at,
            assigned_at,
            provider_responded_at
        FROM tickets
        WHERE provider_id = $1
    `;

    try {
        const res = await pool.query(query, [providerId]);
        const tickets = res.rows || [];

        /* ── Transaccional ── */
        const completed = tickets.filter(t => (t.status || '').toUpperCase() === 'COMPLETADO');

        const totalCompletedJobs = completed.length;

        const totalGMV = completed.reduce((sum, t) => {
            const amt = parseFloat(t.final_amount);
            return sum + (Number.isFinite(amt) ? amt : 0);
        }, 0);

        const ticketPromedio = totalCompletedJobs > 0
            ? Number((totalGMV / totalCompletedJobs).toFixed(2))
            : null;

        /* ── Retención ── */
        const completedWithDate = completed
            .filter(t => t.completed_at)
            .map(t => new Date(t.completed_at).getTime());

        let daysSinceLastJob = null;
        if (completedWithDate.length > 0) {
            const lastJobMs = Math.max(...completedWithDate);
            daysSinceLastJob = Math.floor((Date.now() - lastJobMs) / (1000 * 60 * 60 * 24));
        }

        /* ── Comportamiento ── */
        const assigned = tickets.filter(t => t.assigned_at);
        const totalAssigned = assigned.length;

        // Ghosting estricto: solo cuenta como fantasma si el ticket fue CANCELADO
        // y además nunca hubo respuesta del trabajador. Los tickets COMPLETADO /
        // ACEPTADO / EN_PROGRESO (o similares exitosos) se excluyen explícitamente
        // para evitar falsos positivos con registros históricos sin timestamp de respuesta.
        let ghostedTickets = 0;
        assigned.forEach(t => {
            const status = (t.status || '').toUpperCase();
            const isSafeStatus = ['COMPLETADO', 'ACEPTADO', 'EN_PROGRESO'].includes(status);
            if (!isSafeStatus && status === 'CANCELADO' && !t.provider_responded_at) {
                ghostedTickets++;
            }
        });

        const ghostingRate = totalAssigned > 0
            ? parseFloat(((ghostedTickets / totalAssigned) * 100).toFixed(1))
            : 0;

        const responseDiffs = assigned
            .filter(t => t.provider_responded_at)
            .map(t => {
                const diff = (new Date(t.provider_responded_at) - new Date(t.assigned_at)) / (1000 * 60);
                return diff;
            })
            .filter(d => Number.isFinite(d) && d >= 0);

        const avgResponseTimeMinutes = responseDiffs.length > 0
            ? Number((responseDiffs.reduce((s, v) => s + v, 0) / responseDiffs.length).toFixed(1))
            : null;

        return {
            totalCompletedJobs,
            totalGMV: Number(totalGMV.toFixed(2)),
            ticketPromedio,
            daysSinceLastJob,
            ghostingRate,
            avgResponseTimeMinutes
        };
    } catch (err) {
        console.error('[DB] Error en getIndividualWorkerScoring:', err.message);
        throw err;
    }
}

module.exports = {
    getBehavioralMetrics,
    getActiveWorkersList,
    getIndividualWorkerScoring,
    saveTicket,
    getTickets,
    getTicketById,
    updateTicketStatus,
    assignTicket,
    completeTicket,
    getPendingAmountTicketByProviderPhone,
    updateTicketFinalAmount,
    getPendingReviewTicketByClientPhone,
    updateTicketClientRating,
    normalizePhoneForLedger,
    getTicketsForGhostCheck,
    setGhostCheckSent,
    reopenTicketAfterGhost,
    updateTicketCategorySlug,
    getShadowLedgerHealthMetrics,
    getUser,
    createUser,
    acceptTerms,
    CURRENT_TERMS_VERSION,
    pool
};
