'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;

/**
 * Genera un token interno para llamadas servicio-a-servicio (reviews-service, provider-service).
 * Debe usarse el mismo secret (JWT_SECRET o JWT_ACCESS_SECRET) que los otros servicios.
 */
function generateInternalToken() {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET or JWT_ACCESS_SECRET is required for internal token');
  }
  return jwt.sign(
    { userId: 9999, role: 'admin', isProvider: false },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

module.exports = { generateInternalToken };
