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
 * Actualiza el estado de un ticket.
 * @param {number} id - ID del ticket.
 * @param {string} newStatus - Nuevo estado (ABIERTO, ASIGNADO, COMPLETADO, CANCELADO).
 */
async function updateTicketStatus(id, newStatus) {
    const query = 'UPDATE tickets SET status = $1 WHERE id = $2 RETURNING *;';
    try {
        const res = await pool.query(query, [newStatus, id]);
        return res.rows[0];
    } catch (err) {
        console.error('[DB] Error al actualizar estado del ticket:', err.message);
        throw err;
    }
}

module.exports = {
    saveTicket,
    getTickets,
    updateTicketStatus,
    getUser,
    createUser,
    acceptTerms,
    CURRENT_TERMS_VERSION,
    pool
};
