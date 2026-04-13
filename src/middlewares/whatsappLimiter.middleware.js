'use strict';

const WINDOW_MS = 30_000;
const MAX_MESSAGES = 5;
const userMessageCounts = new Map();

function whatsappLimiter(req, res, next) {
    const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED === 'true';
    if (!rateLimitEnabled) {
        return next();
    }

    const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    if (!from) {
        return next();
    }

    let userState = userMessageCounts.get(from);
    if (!userState) {
        const timeoutId = setTimeout(() => {
            userMessageCounts.delete(from);
        }, WINDOW_MS);
        userState = { count: 0, timeoutId };
        userMessageCounts.set(from, userState);
    }

    userState.count += 1;

    if (userState.count > MAX_MESSAGES) {
        console.warn('[WhatsAppLimiter] Mensaje bloqueado por exceso de frecuencia.', { from, count: userState.count });
        res.sendStatus(200);
        return;
    }

    next();
}

module.exports = {
    whatsappLimiter,
    WINDOW_MS,
    MAX_MESSAGES
};
