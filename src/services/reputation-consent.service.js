'use strict';

const axios = require('axios');
const { getProviderBaseUrl } = require('./provider-client.service');

const TTL_MS = 15 * 60 * 1000; // 15 min
const cache = new Map();
let warnedMissingKey = false;

function getInternalKey() {
  return process.env.CREDIT_EVENTS_INTERNAL_KEY || process.env.INTERNAL_API_KEY || process.env.JWT_SECRET || '';
}

/**
 * @param {number|string} providerId
 * @returns {Promise<boolean>} true solo si reputation_consent === true en provider-service
 */
async function fetchReputationConsentFromProvider(providerId) {
  const base = getProviderBaseUrl();
  const key = getInternalKey();
  const url = `${base}/api/v1/internal/providers/${encodeURIComponent(providerId)}/reputation-consent`;
  const { data } = await axios.get(url, {
    headers: { 'x-internal-key': key },
    timeout: 10_000,
    validateStatus: (s) => s === 200 || s === 404
  });
  if (data && data.reputation_consent === true) return true;
  return false;
}

/**
 * Indica si se puede insertar en credit_events para este proveedor.
 * Caché en memoria por provider_id, TTL 15 min.
 * Sin INTERNAL key: no se puede validar vía API; se emite warning una vez y se permite (compat. dev).
 * Con key: fallo de red o 404 → false (fail-closed en privacidad).
 *
 * @param {number|string} providerId
 * @returns {Promise<boolean>}
 */
async function isReputationConsentGranted(providerId) {
  const id = Number(providerId);
  if (!id || Number.isNaN(id)) return false;

  if (!getInternalKey()) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        '[ReputationConsent] CREDIT_EVENTS_INTERNAL_KEY / JWT_SECRET not set: consent gating is DISABLED (all credit events allowed).'
      );
    }
    return true;
  }

  const now = Date.now();
  const entry = cache.get(id);
  if (entry && entry.expires > now) {
    return entry.allowed;
  }

  let allowed = false;
  try {
    allowed = await fetchReputationConsentFromProvider(id);
  } catch (err) {
    const msg = err.response ? `${err.response.status} ${JSON.stringify(err.response.data || '')}` : err.message;
    console.warn(`[ReputationConsent] fetch failed for provider ${id}:`, msg);
    allowed = false;
  }
  cache.set(id, { allowed, expires: now + TTL_MS });
  return allowed;
}

/** Invalida caché (ej. tras futuro flujo de re-consent en perfil). */
function clearReputationConsentCache(providerId) {
  if (providerId == null) {
    cache.clear();
  } else {
    cache.delete(Number(providerId));
  }
}

module.exports = {
  isReputationConsentGranted,
  clearReputationConsentCache
};
