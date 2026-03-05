'use strict';

const axios = require('axios');

/**
 * Base URL del provider-service (directo, gateway o local).
 */
function getProviderBaseUrl() {
    const direct = process.env.PROVIDER_SERVICE_URL && process.env.PROVIDER_SERVICE_URL.trim();
    const gateway = process.env.API_GATEWAY_URL && process.env.API_GATEWAY_URL.trim();
    if (direct) return direct.replace(/\/$/, '');
    if (gateway) return gateway.replace(/\/$/, '');
    return 'http://localhost:4003';
}

/**
 * Obtiene un proveedor por ID desde el provider-service.
 * @param {number|string} providerId - ID del proveedor.
 * @returns {Promise<{ whatsapp_e164?: string, phone_e164?: string, [key: string]: any } | null>}
 */
async function getProviderById(providerId) {
    const baseUrl = getProviderBaseUrl();
    const url = `${baseUrl}/api/v1/providers/${providerId}`;
    try {
        const { data } = await axios.get(url, { timeout: 10_000 });
        const provider = data?.provider;
        return provider || null;
    } catch (err) {
        console.error('[ProviderClient] Error al obtener proveedor:', err.message);
        if (err.response) console.error('[ProviderClient] Status:', err.response.status, err.response.data);
        return null;
    }
}

/**
 * Obtiene el número de WhatsApp (o teléfono) del proveedor para enviar mensajes.
 * @param {number|string} providerId - ID del proveedor.
 * @returns {Promise<string|null>} Número E.164 o null.
 */
async function getProviderWhatsAppNumber(providerId) {
    const provider = await getProviderById(providerId);
    if (!provider) return null;
    const phone = provider.whatsapp_e164 || provider.phone_e164;
    return phone && String(phone).trim() ? String(phone).trim() : null;
}

module.exports = { getProviderById, getProviderWhatsAppNumber, getProviderBaseUrl };
