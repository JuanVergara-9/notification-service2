'use strict';

const { GoogleGenAI } = require('@google/genai');
const { getDefaultServiceCity, enrichExtractedDataWithServiceArea } = require('../config/serviceArea');

const apiKey = process.env.GEMINI_API_KEY;
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;
const SAFETY_FALLBACK_REPLY = "Disculpá, no puedo procesar ese tipo de mensajes. Estoy acá para ayudarte a encontrar el profesional que necesitás en San Rafael. ¿Buscás algún rubro en particular?";

// Almacenamiento temporal de sesiones en memoria
const sessions = new Map();

function buildSystemInstruction() {
    const metro = process.env.SERVICE_AREA_CUSTOMER_HINT || getDefaultServiceCity();
    return `Eres el recepcionista virtual de "miservicio", un marketplace de oficios. Tu objetivo es entender qué necesita el cliente y asegurarte de tener 4 datos clave: category, description, zone (barrio, zona o ciudad), y urgency (alta, media, o baja).

Tu respuesta DEBE ser SIEMPRE un JSON válido con esta estructura exacta:
{
  "isComplete": boolean, 
  "extractedData": {
    "category": "string o null",
    "description": "string o null",
    "zone": "string o null",
    "urgency": "alta, media, baja o null"
  },
  "replyToClient": "string"
}

Zona y cobertura (MUY IMPORTANTE):
- Hoy la operación principal es en ${metro} (y otras ciudades cuando el sistema las habilite). Si el usuario dice solo un barrio o referencia local ("el centro", "cerca del shopping", "zona norte", "Colón"), eso cuenta como zona válida: guardá en "zone" lo que dijo el usuario (no rechaces por no mencionar la ciudad).
- Si el usuario ya nombró una ciudad de la zona de servicio, podés usarla en "zone" (ej: "Centro, ${metro}").
- Si menciona una ciudad fuera de la cobertura actual, explicá con empatía que por ahora canalizás pedidos en ${metro} y pedí confirmación si el trabajo es ahí.
- Cuando falte la zona o la urgencia, isComplete=false y preguntá solo por lo que falta. Para la zona, preguntá por el barrio o zona dentro de ${metro} (ej: "¿En qué barrio o zona de ${metro} necesitás el servicio?").

Categorías válidas (usá EXACTAMENTE uno de estos nombres en "category"):
- Electricidad
- Plomería
- Gasistas
- Jardinería
- Carpintería
- Pintura
- Mantenimiento y limpieza de piletas
- Reparación de electrodomésticos

Mapeo de sinónimos (lo que dice el cliente → categoría correcta):
- "técnico", "service", "heladera", "lavarropa", "lavarropas", "secarropas", "aire acondicionado", "microondas", "horno", "freezer", "termotanque", "calefón" → "Reparación de electrodomésticos"
- "electricista" → "Electricidad"
- "plomero", "caño", "cañería" → "Plomería"
- "gasista", "gas" → "Gasistas"
- "jardinero", "jardín", "pasto", "poda" → "Jardinería"
- "carpintero", "mueble", "madera" → "Carpintería"
- "pintor" → "Pintura"
- "pileta", "piscina" → "Mantenimiento y limpieza de piletas"

Reglas de diálogo:
1. Si falta categoría, descripción, zona o urgencia, isComplete debe ser false. En replyToClient preguntá SOLO por lo que falta, en un mensaje corto y empático.
2. Si ya tenés las cuatro cosas (incluida zona aunque sea solo un barrio), isComplete debe ser true, y en replyToClient confirmá el pedido de forma breve sin volver a pedir datos que el usuario ya dio en la conversación.
3. Si el usuario pide un "técnico" sin especificar qué, preguntá brevemente qué electrodoméstico o equipo necesita reparar, y usá "Reparación de electrodomésticos" como categoría.
Responde únicamente con el JSON, sin texto adicional.

IMPORTANTE: Eres estrictamente un asistente para "miservicio", una plataforma de oficios. Si el usuario hace preguntas fuera de contexto (política, chistes, consultas generales), usa lenguaje ofensivo, o pide cosas inapropiadas/ilegales, DEBES negarte a responder amablemente. Usa frases como: "Soy el asistente virtual de miservicio, solo puedo ayudarte a buscar profesionales o gestionar tus pedidos de oficios. ¿En qué rubro te puedo ayudar hoy?"`;
}

function buildSafetyFallback() {
    return {
        isComplete: false,
        extractedData: {
            category: null,
            description: null,
            zone: null,
            urgency: null
        },
        replyToClient: SAFETY_FALLBACK_REPLY
    };
}

function isSafetyBlockedError(err) {
    const raw = `${err?.message || ''} ${JSON.stringify(err || {})}`.toLowerCase();
    return (
        raw.includes('safety') ||
        raw.includes('blocked') ||
        raw.includes('harm') ||
        raw.includes('prompt_feedback') ||
        raw.includes('finishreason')
    );
}

/**
 * Analiza un mensaje de texto con Gemini manteniendo el contexto de la conversación.
 * @param {string} from - Número del usuario (ID de sesión)
 * @param {string} text - Mensaje entrante
 * @returns {Promise<object>}
 */
async function analyzeMessage(from, text) {
    if (!client) {
        console.error('[Gemini] GEMINI_API_KEY no configurada.');
        return { error: 'ai_not_configured' };
    }
    if (!text || typeof text !== 'string') {
        return { error: 'not_a_service' };
    }

    // Obtener o crear el historial de la sesión
    if (!sessions.has(from)) {
        sessions.set(from, []);
    }
    const history = sessions.get(from);

    // Agregar el mensaje actual al historial
    history.push({ role: 'user', parts: [{ text }] });

    try {
        const response = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: history,
            config: {
                systemInstruction: buildSystemInstruction(),
                safetySettings: [
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
                ]
            }
        });

        const output = response.text.trim();

        // Intentar extraer JSON
        let jsonStr = output;
        const codeBlock = output.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
            jsonStr = codeBlock[1].trim();
        }
        
        const parsed = JSON.parse(jsonStr);

        if (parsed.extractedData) {
            parsed.extractedData = enrichExtractedDataWithServiceArea(parsed.extractedData);
            const ex = parsed.extractedData;
            const hasAll = [ex.category, ex.description, ex.zone, ex.urgency].every(
                (x) => x != null && String(x).trim() !== ''
            );
            if (hasAll) {
                parsed.isComplete = true;
            }
        }

        // Mantener contexto hasta matchmaking exitoso (notification.routes llama clearUserSession).
        history.push({ role: 'model', parts: [{ text: output }] });

        console.log('[Gemini] Análisis con memoria completado.');
        return parsed;
    } catch (err) {
        console.error('[Gemini] Error en analyzeMessage:', err.message);
        if (isSafetyBlockedError(err)) {
            console.warn('[Gemini] Contenido bloqueado por safety. Respondiendo fallback controlado.');
            return buildSafetyFallback();
        }
        return { error: err.message || 'parse_error' };
    }
}

function clearUserSession(from) {
    if (sessions.has(from)) {
        sessions.delete(from);
        console.log(`[Gemini] Sesión limpiada para ${from}.`);
    }
}

module.exports = { analyzeMessage, clearUserSession };
