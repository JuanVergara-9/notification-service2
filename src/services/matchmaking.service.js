'use strict';

const axios = require('axios');

/**
 * Servicio de Matchmaking para conectar tickets con profesionales.
 * Se comunica con el provider-service vía HTTP.
 */

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://localhost:4003';

/**
 * Busca profesionales que coincidan con los datos del ticket.
 * @param {object} ticketData - { category, zone, urgency }
 * @returns {Promise<Array>} Top 3 profesionales encontrados.
 */
async function findMatchingProviders(ticketData) {
    const { category, zone, urgency } = ticketData;
    
    console.log(`[Matchmaking] Buscando profesionales para: ${category} en ${zone} (Urgencia: ${urgency})`);

    try {
        // Limpieza total de la URL base para evitar duplicados o barras extras
        const baseUrl = PROVIDER_SERVICE_URL
            .trim()
            .replace(/\/api\/v1\/?$/, '') // Quita /api/v1 si existe
            .replace(/\/$/, '');          // Quita la barra final si existe
            
        const fullUrl = `${baseUrl}/api/v1/providers`;
        
        console.log(`[Matchmaking] URL FINAL: ${fullUrl}`);

        const response = await axios.get(fullUrl, {
            params: {
                city: zone,
                categoryName: category,
                urgency: urgency,
                status: 'active',
                limit: 10
            },
            timeout: 7000
        });

        // El provider-service devuelve los datos en .items
        if (!response.data || !response.data.items) {
            console.log('[Matchmaking] Respuesta sin items:', response.data);
            return [];
        }

        let providers = response.data.items;

        // Regla de Urgencia: Si es Alta, priorizar emergency_available
        if (urgency && (urgency.toLowerCase() === 'alta' || urgency.toLowerCase() === 'urgente')) {
            providers.sort((a, b) => {
                if (a.emergency_available && !b.emergency_available) return -1;
                if (!a.emergency_available && b.emergency_available) return 1;
                return 0;
            });
        }

        // Priorizar is_pro
        providers.sort((a, b) => {
            if (a.is_pro && !b.is_pro) return -1;
            if (!a.is_pro && b.is_pro) return 1;
            return 0;
        });

        // Retornar top 3 con los campos necesarios
        return providers.slice(0, 3).map(p => ({
            id: p.id,
            name: `${p.first_name} ${p.last_name}`,
            avatar_url: p.avatar_url,
            whatsapp_e164: p.whatsapp_e164,
            is_pro: p.is_pro,
            identity_status: p.identity_status,
            emergency_available: p.emergency_available
        }));

    } catch (error) {
        console.error('[Matchmaking] Error consultando provider-service:', error.message);
        if (error.response) {
            console.error('[Matchmaking] Detalle del error:', error.response.status, error.response.data);
        }
        return [];
    }
}

module.exports = { findMatchingProviders };
