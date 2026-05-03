'use strict';

/**
 * Área de cobertura del bot / matchmaking (configurable por entorno).
 *
 * DEFAULT_SERVICE_CITY — ciudad por defecto cuando el usuario solo indica barrio/zona (ej: "centro").
 * SERVICE_COVERED_CITIES — lista separada por comas de ciudades donde operamos (para matching y detección en texto).
 *   Ejemplo futuro: "San Rafael,Godoy Cruz,Las Heras"
 */
function getDefaultServiceCity() {
    const v = (process.env.DEFAULT_SERVICE_CITY || 'San Rafael').trim();
    return v || 'San Rafael';
}

function getCoveredCities() {
    const raw = process.env.SERVICE_COVERED_CITIES || getDefaultServiceCity();
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function getCoveredCitiesLower() {
    return getCoveredCities().map((c) => c.toLowerCase());
}

function zoneStringMentionsCoveredCity(zoneText) {
    if (!zoneText || typeof zoneText !== 'string') return false;
    const lower = zoneText.toLowerCase();
    return getCoveredCitiesLower().some((c) => lower.includes(c));
}

/**
 * Zona guardada en ticket / mostrada: si solo hay barrio, se antepone o agrega la ciudad por defecto.
 */
function enrichTicketZone(zone) {
    const def = getDefaultServiceCity();
    const z = (zone || '').trim();
    if (!z) return def;
    if (zoneStringMentionsCoveredCity(z)) return z;
    return `${z}, ${def}`;
}

/**
 * Ciudad a usar en provider-service (evita buscar city="centro").
 * Si el texto menciona alguna ciudad cubierta, se usa esa; si no, la ciudad por defecto.
 */
function extractCityForProviderSearch(zone) {
    const def = getDefaultServiceCity();
    const cities = getCoveredCities();
    const z = (zone || '').trim();
    if (!z) return def;

    const lower = z.toLowerCase();
    let best = null;
    let bestLen = 0;
    for (const city of cities) {
        const cl = city.toLowerCase();
        if (lower.includes(cl) && cl.length > bestLen) {
            best = city;
            bestLen = cl.length;
        }
    }
    if (best) return best;

    const parts = z.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
        const pl = part.toLowerCase();
        for (const city of cities) {
            const cl = city.toLowerCase();
            if (pl.includes(cl) || cl.includes(pl)) return city;
        }
    }

    return def;
}

/**
 * Ajusta extractedData del modelo antes de persistir / matchear.
 */
function enrichExtractedDataWithServiceArea(extractedData) {
    if (!extractedData || typeof extractedData !== 'object') return extractedData;
    const out = { ...extractedData };
    const raw = out.zone != null ? String(out.zone).trim() : '';
    if (!raw) {
        return out;
    }
    out.zone = enrichTicketZone(raw);
    return out;
}

module.exports = {
    getDefaultServiceCity,
    getCoveredCities,
    enrichTicketZone,
    extractCityForProviderSearch,
    enrichExtractedDataWithServiceArea,
    zoneStringMentionsCoveredCity,
};
