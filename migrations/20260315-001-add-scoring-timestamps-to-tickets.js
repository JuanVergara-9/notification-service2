'use strict';

/**
 * Migración: columnas de timestamps para el modelo de scoring crediticio (Shadow Ledger).
 * Añade a la tabla tickets: assigned_at, provider_responded_at, completed_at, amount_reported_at, cancellation_reason.
 * Idempotente: usa IF NOT EXISTS por columna.
 *
 * Uso: desde la raíz del notification-service con DATABASE_URL en el entorno:
 *   node migrations/20260315-001-add-scoring-timestamps-to-tickets.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined
});

const SQL = `
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'assigned_at') THEN
        ALTER TABLE tickets ADD COLUMN assigned_at TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'provider_responded_at') THEN
        ALTER TABLE tickets ADD COLUMN provider_responded_at TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'completed_at') THEN
        ALTER TABLE tickets ADD COLUMN completed_at TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'amount_reported_at') THEN
        ALTER TABLE tickets ADD COLUMN amount_reported_at TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'cancellation_reason') THEN
        ALTER TABLE tickets ADD COLUMN cancellation_reason VARCHAR(255);
    END IF;
END $$;
`;

async function run() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL no está definida.');
        process.exit(1);
    }
    try {
        await pool.query(SQL);
        console.log('[Migration] 20260315-001: columnas de scoring (assigned_at, provider_responded_at, completed_at, amount_reported_at, cancellation_reason) añadidas o ya existían.');
    } catch (err) {
        console.error('[Migration] Error:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
