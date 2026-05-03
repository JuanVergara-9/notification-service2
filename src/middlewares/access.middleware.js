'use strict';

const jwt = require('jsonwebtoken');
const axios = require('axios');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

function authDisabled() {
    return String(process.env.NOTIFICATION_AUTH_DISABLED || '').toLowerCase() === 'true';
}

function getInternalApiKey() {
    return (
        process.env.NOTIFICATION_INTERNAL_API_KEY ||
        process.env.CREDIT_EVENTS_INTERNAL_KEY ||
        ''
    ).trim();
}

/**
 * Valida Bearer JWT (mismo secret que auth-service / provider-service).
 */
function requireBearerJwt(req, res, next) {
    if (authDisabled()) return next();

    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Token requerido', code: 'AUTH.MISSING_TOKEN' });
    }
    if (!ACCESS_SECRET) {
        console.error('[notification-auth] JWT_ACCESS_SECRET / JWT_SECRET no configurado');
        return res.status(503).json({ error: 'Autenticación no configurada en el servidor', code: 'AUTH.NOT_CONFIGURED' });
    }
    try {
        const payload = jwt.verify(token, ACCESS_SECRET, { clockTolerance: 10 });
        const userId = Number(payload.userId);
        if (!userId || Number.isNaN(userId)) {
            return res.status(401).json({ error: 'Token inválido', code: 'AUTH.INVALID_TOKEN' });
        }
        req.auth = {
            userId,
            role: payload.role || '',
            isProvider: !!payload.isProvider,
        };
        return next();
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido o expirado', code: 'AUTH.INVALID_TOKEN' });
    }
}

function requireAdminJwt(req, res, next) {
    if (authDisabled()) return next();
    return requireBearerJwt(req, res, () => {
        if (req.auth && req.auth.role === 'admin') {
            return next();
        }
        return res.status(403).json({ error: 'Se requieren permisos de administrador', code: 'AUTH.FORBIDDEN' });
    });
}

function providerBaseUrl() {
    const direct = (process.env.PROVIDER_SERVICE_URL || '').trim().replace(/\/+$/, '');
    const gateway = (process.env.API_GATEWAY_URL || '').trim().replace(/\/+$/, '');
    return direct || gateway || '';
}

/**
 * Tras requireBearerJwt: admin cualquier id; proveedor solo su propio provider_id.
 */
async function requireWorkerDashboardOwner(req, res, next) {
    if (authDisabled()) return next();
    if (!req.auth) {
        return res.status(401).json({ error: 'No autenticado', code: 'AUTH.MISSING_TOKEN' });
    }
    if (req.auth.role === 'admin') {
        return next();
    }
    const providerId = Number(req.params.id);
    if (!providerId || Number.isNaN(providerId)) {
        return res.status(400).json({ error: 'providerId inválido' });
    }
    const base = providerBaseUrl();
    if (!base) {
        return res.status(503).json({ error: 'Provider service no configurado' });
    }
    const authHeader = req.headers.authorization || '';
    try {
        const r = await axios.get(`${base}/api/v1/providers/mine`, {
            headers: { Authorization: authHeader },
            timeout: 6000,
        });
        const mineId = r.data?.provider?.id;
        if (mineId != null && Number(mineId) === providerId) {
            return next();
        }
    } catch (err) {
        console.warn('[notification-auth] providers/mine:', err.message);
    }
    return res.status(403).json({ error: 'No autorizado para este recurso', code: 'AUTH.FORBIDDEN' });
}

/**
 * Llamadas servicio-a-servicio (provider-service → send-whatsapp).
 */
function requireInternalNotificationKey(req, res, next) {
    if (authDisabled()) return next();
    const expected = getInternalApiKey();
    if (!expected) {
        console.warn(
            '[notification-auth] NOTIFICATION_INTERNAL_API_KEY / CREDIT_EVENTS_INTERNAL_KEY no definidos: ' +
                `${req.method} ${req.path} queda sin validación de clave interna (configurá en producción).`
        );
        return next();
    }
    const got = (req.headers['x-internal-key'] || '').trim();
    if (got !== expected) {
        return res.status(401).json({ error: 'Unauthorized', code: 'AUTH.INVALID_INTERNAL_KEY' });
    }
    return next();
}

module.exports = {
    requireBearerJwt,
    requireAdminJwt,
    requireWorkerDashboardOwner,
    requireInternalNotificationKey,
    getInternalApiKey,
};
