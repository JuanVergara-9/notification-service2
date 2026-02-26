'use strict';

const axios = require('axios');

/**
 * Servicio de Matchmaking para conectar tickets con profesionales.
 * Se comunica con el provider-service vía HTTP (directo o a través del API Gateway).
 *
 * Uso recomendado en producción: API_GATEWAY_URL. El gateway expone GET /api/v1/providers
 * y hace proxy al provider-service; así solo necesitas una URL y evitas 404 por rutas.
 */

// Prioridad: PROVIDER_SERVICE_URL (directo) evita 404 si el gateway no está disponible en Railway.
function getProviderBaseUrl() {
  const direct = process.env.PROVIDER_SERVICE_URL && process.env.PROVIDER_SERVICE_URL.trim();
  const gateway = process.env.API_GATEWAY_URL && process.env.API_GATEWAY_URL.trim();
  if (direct) return { url: direct.replace(/\/$/, ''), via: 'direct' };
  if (gateway) return { url: gateway.replace(/\/$/, ''), via: 'gateway' };
  return { url: 'http://localhost:4003', via: 'local' };
}

/**
 * Sinónimos del ticket (lo que dice el usuario/Gemini) → slug de categoría en provider-service.
 * Las categorías en DB son: plomeria, gasistas, electricidad, jardineria, etc. (ver seeders).
 */
const CATEGORY_SLUG_MAP = {
  electricista: 'electricidad',
  electricidad: 'electricidad',
  plomero: 'plomeria',
  plomería: 'plomeria',
  plomeria: 'plomeria',
  gasista: 'gasistas',
  gasistas: 'gasistas',
  jardinero: 'jardineria',
  jardinería: 'jardineria',
  jardineria: 'jardineria',
  carpintero: 'carpinteria',
  carpintería: 'carpinteria',
  carpinteria: 'carpinteria',
  pintor: 'pintura',
  pintura: 'pintura',
  pileta: 'mantenimiento-limpieza-piletas',
  piletas: 'mantenimiento-limpieza-piletas',
  electrodomésticos: 'reparacion-electrodomesticos',
  electrodomesticos: 'reparacion-electrodomesticos'
};

function normalizeCategoryForApi(category) {
  if (!category || typeof category !== 'string') return { categoryName: category || '', categorySlug: undefined };
  const key = category.trim().toLowerCase();
  const slug = CATEGORY_SLUG_MAP[key];
  if (slug) return { categoryName: undefined, categorySlug: slug };
  return { categoryName: category.trim(), categorySlug: undefined };
}

/**
 * Normaliza la zona para búsqueda: "San Rafael Mendoza" → ciudad "San Rafael", provincia "Mendoza".
 */
function parseZone(zone) {
  if (!zone || typeof zone !== 'string') return { city: '', province: '' };
  const t = zone.trim();
  const parts = t.split(',').map(s => s.trim()).filter(Boolean);
  const city = parts[0] || t;
  const province = parts[1] || '';
  return { city, province };
}

function normalizeZoneForSearch(zone) {
  return parseZone(zone).city || zone || '';
}

const DEFAULT_RADIUS_KM = 40;

/**
 * Obtiene coordenadas de la zona vía geolocation-service (opcional).
 * Si GEOLOCATION_SERVICE_URL está definida, llama GET /api/v1/geo/geocode y devuelve { lat, lng }.
 */
async function geocodeZone(zone) {
  const geoUrl = process.env.GEOLOCATION_SERVICE_URL && process.env.GEOLOCATION_SERVICE_URL.trim();
  const gatewayUrl = process.env.API_GATEWAY_URL && process.env.API_GATEWAY_URL.trim();
  const base = (geoUrl || gatewayUrl || '').replace(/\/$/, '');
  if (!base) return null;

  const { city, province } = parseZone(zone);
  if (!city) return null;

  const url = `${base}/api/v1/geo/geocode`;
  const params = new URLSearchParams({ city });
  if (province) params.set('province', province);

  try {
    const res = await axios.get(`${url}?${params.toString()}`, { timeout: 4000 });
    if (res.data && typeof res.data.lat === 'number' && typeof res.data.lng === 'number') {
      return { lat: res.data.lat, lng: res.data.lng };
    }
    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log('[Matchmaking] Geolocation: zona no encontrada en catálogo:', city, province || '');
    } else {
      console.warn('[Matchmaking] Geolocation no disponible:', err.message);
    }
    return null;
  }
}

/**
 * Busca profesionales que coincidan con los datos del ticket.
 * @param {object} ticketData - { category, zone, urgency }
 * @returns {Promise<Array>} Top 3 profesionales encontrados.
 */
async function findMatchingProviders(ticketData) {
    const { category, zone, urgency } = ticketData;
    
    console.log(`[Matchmaking] Buscando profesionales para: ${category} en ${zone} (Urgencia: ${urgency})`);

    try {
        const { url: baseUrl, via } = getProviderBaseUrl();
        const baseClean = baseUrl.replace(/\/api\/v1\/?$/, '');
        const fullUrl = `${baseClean}/api/v1/providers`;

        console.log(`[Matchmaking] URL FINAL: ${fullUrl} (via ${via})`);

        const { categoryName: apiCategoryName, categorySlug: apiCategorySlug } = normalizeCategoryForApi(category);
        const cityForSearch = normalizeZoneForSearch(zone);
        if (apiCategorySlug) console.log(`[Matchmaking] Categoría normalizada: "${category}" → slug "${apiCategorySlug}"`);
        if (cityForSearch !== (zone || '').trim()) console.log(`[Matchmaking] Zona normalizada: "${zone}" → ciudad búsqueda "${cityForSearch}"`);

        const params = {
            city: cityForSearch,
            urgency: urgency,
            status: 'active',
            limit: 10
        };
        if (apiCategorySlug) params.categorySlug = apiCategorySlug;
        else if (apiCategoryName) params.categoryName = apiCategoryName;

        const coords = await geocodeZone(zone);
        if (coords) {
            params.lat = coords.lat;
            params.lng = coords.lng;
            params.radiusKm = Number(process.env.MATCHMAKING_RADIUS_KM) || DEFAULT_RADIUS_KM;
            console.log(`[Matchmaking] Búsqueda por radio: ${params.radiusKm} km desde (${coords.lat}, ${coords.lng})`);
        }

        const response = await axios.get(fullUrl, {
            params,
            timeout: 7000
        });

        // El provider-service devuelve { count, items }
        if (!response.data || !Array.isArray(response.data.items)) {
            console.log('[Matchmaking] Respuesta sin items:', response.data);
            return [];
        }

        let providers = response.data.items;
        const total = response.data.count != null ? response.data.count : providers.length;
        if (providers.length === 0) {
            console.log(`[Matchmaking] Provider-service OK pero 0 resultados (count=${total}). Revisa que haya proveedores activos para categoría "${category}" y ciudad "${zone}".`);
            return [];
        }

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
