/* eslint-disable no-console */
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL no está definido en el entorno.');
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const beforeRes = await pool.query('SELECT COUNT(*)::int AS count FROM tickets');
    const before = beforeRes.rows[0]?.count ?? 0;
    console.log(`[clear-tickets] Tickets antes: ${before}`);

    await pool.query('BEGIN');
    await pool.query('DELETE FROM tickets');
    await pool.query("SELECT setval(pg_get_serial_sequence('tickets','id'), 1, false)");
    await pool.query('COMMIT');

    const afterRes = await pool.query('SELECT COUNT(*)::int AS count FROM tickets');
    const after = afterRes.rows[0]?.count ?? 0;
    console.log(`[clear-tickets] Tickets despues: ${after}`);
    console.log('[clear-tickets] Limpieza completada con exito.');
  } catch (error) {
    try {
      await pool.query('ROLLBACK');
    } catch (_) {
      // no-op
    }
    console.error('[clear-tickets] Error durante la limpieza:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
