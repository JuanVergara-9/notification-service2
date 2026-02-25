'use strict';

const axios = require('axios');

/**
 * Servicio de Matchmaking para conectar tickets con proveedores.
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
        // Consultamos al provider-service usando sus filtros existentes
        // El endpoint GET /api/v1/providers soporta city, status, isLicensed, etc.
        // Nota: El matchmaking ideal sería por categorySlug, pero usaremos lo que tenemos.
        const response = await axios.get(`${PROVIDER_SERVICE_URL}/api/v1/providers`, {
            params: {
                city: zone,
                categoryName: category, // Usamos el nuevo filtro por nombre
                urgency: urgency, // Pasamos la urgencia para el ordenamiento en el servidor
                status: 'active',
                limit: 10 // Pedimos algunos más para el filtrado final si fuera necesario
            },
            timeout: 5000
        });

        if (!response.data || !response.data.items) {
            return [];
        }

        let providers = response.data.items;

        // 1. Filtrar por categoría (ya que el endpoint actual puede no filtrar estrictamente por nombre de categoría si no es slug)
        // Si el provider-service no filtra por nombre exacto de categoría, lo hacemos aquí:
        providers = providers.filter(p => {
            const hasCategory = (p.category && p.category.name.toLowerCase() === category.toLowerCase()) ||
                               (p.categories && p.categories.some(c => c.name.toLowerCase() === category.toLowerCase()));
            return hasCategory;
        });

        // 2. Regla de Urgencia: Si es Alta, priorizar emergency_available
        if (urgency && (urgency.toLowerCase() === 'alta' || urgency.toLowerCase() === 'urgente')) {
            providers.sort((a, b) => {
                if (a.emergency_available && !b.emergency_available) return -1;
                if (!a.emergency_available && b.emergency_available) return 1;
                return 0;
            });
        }

        // 3. Priorizar is_pro
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
        return [];
    }
}

module.exports = { findMatchingProviders };
