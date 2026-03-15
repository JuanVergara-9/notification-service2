'use strict';

/**
 * Esquema de la tabla tickets (fuente de verdad para columnas).
 * Usado por el Shadow Ledger y el flujo de pedidos/matchmaking.
 *
 * Timestamps de scoring (Shadow Ledger):
 * - assigned_at: cuando el estado pasa a ASIGNADO (cliente elige trabajador).
 * - provider_responded_at: cuando el trabajador responde/acepta por WhatsApp.
 * - completed_at: cuando el estado pasa a COMPLETADO.
 * - amount_reported_at: cuando el trabajador declara final_amount.
 * - cancellation_reason: motivo de cancelación si status = CANCELADO.
 */
const TICKET_COLUMNS = {
    id: 'SERIAL PRIMARY KEY',
    phone_number: 'VARCHAR(20) NOT NULL',
    category: 'VARCHAR(100)',
    description: 'TEXT',
    zone: 'VARCHAR(100)',
    urgency: 'VARCHAR(50)',
    status: "VARCHAR(20) DEFAULT 'ABIERTO'",
    source: 'VARCHAR(20)',
    created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    provider_id: 'INTEGER',
    provider_name: 'VARCHAR(200)',
    provider_phone: 'VARCHAR(32)',
    final_amount: 'NUMERIC(12, 2)',
    ghost_check_sent: 'BOOLEAN DEFAULT false',
    client_rating: 'INTEGER',
    category_slug: 'VARCHAR(100)',
    // Scoring / Shadow Ledger timestamps
    assigned_at: 'TIMESTAMP',
    provider_responded_at: 'TIMESTAMP',
    completed_at: 'TIMESTAMP',
    amount_reported_at: 'TIMESTAMP',
    cancellation_reason: 'VARCHAR(255)'
};

const STATUS = {
    ABIERTO: 'ABIERTO',
    ASIGNADO: 'ASIGNADO',
    COMPLETADO: 'COMPLETADO',
    CANCELADO: 'CANCELADO'
};

module.exports = {
    TICKET_COLUMNS,
    STATUS,
    TABLE_NAME: 'tickets'
};
