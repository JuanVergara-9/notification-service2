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

/**
 * Script de inicialización: Crea la tabla 'tickets' si no existe.
 * Query SQL:
 * CREATE TABLE IF NOT EXISTS tickets (
 *   id SERIAL PRIMARY KEY,
 *   phone_number VARCHAR(20) NOT NULL,
 *   category VARCHAR(100),
 *   description TEXT,
 *   zone VARCHAR(100),
 *   urgency VARCHAR(50),
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 * );
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(query);
        console.log('[DB] Tabla "tickets" verificada/creada con éxito.');
    } catch (err) {
        console.error('[DB] Error al inicializar la tabla:', err.message);
    }
};

// Ejecutar inicialización al cargar el servicio
initDB();

/**
 * Guarda un ticket en la base de datos.
 * @param {string} phone - Número de teléfono del remitente.
 * @param {object} ticketData - Datos extraídos por la IA (category, description, zone, urgency).
 */
async function saveTicket(phone, ticketData) {
    const { category, description, zone, urgency } = ticketData;
    const query = `
        INSERT INTO tickets (phone_number, category, description, zone, urgency)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id;
    `;
    const values = [phone, category, description, zone, urgency];

    try {
        const res = await pool.query(query, values);
        console.log(`[DB] Ticket guardado con éxito. ID: ${res.rows[0].id}`);
        return res.rows[0].id;
    } catch (err) {
        console.error('[DB] Error al insertar ticket:', err.message);
        throw err; // Re-lanzar para que el llamador decida cómo manejarlo
    }
}

module.exports = {
    saveTicket,
    pool
};
