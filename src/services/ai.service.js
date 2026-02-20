'use strict';

const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY;
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Almacenamiento temporal de sesiones en memoria
const sessions = new Map();

const SYSTEM_INSTRUCTION = `Eres el recepcionista virtual de "miservicio", un marketplace de oficios. Tu objetivo es entender qué necesita el cliente y asegurarte de tener 4 datos clave: category, description, zone (barrio/ciudad), y urgency (alta, media, o baja).

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

Reglas de diálogo:
1. Si el usuario no te da la zona o no queda clara la urgencia, isComplete debe ser false. En replyToClient debes redactar un mensaje natural, cortito y empático preguntando SOLO por el dato que falta (ej: "¡Hola! Te busco un técnico para la heladera. ¿En qué zona de la ciudad estás y qué tan urgente es?").
2. Si ya tienes zona, descripción, categoría y urgencia, isComplete debe ser true, y en replyToClient redactas la confirmación final (ej: "¡Perfecto! Ya registré tu pedido para arreglar la heladera en el centro con urgencia media. Le estoy avisando a los técnicos.").
Responde únicamente con el JSON, sin texto adicional.`;

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
            contents: [
                { role: 'user', parts: [{ text: SYSTEM_INSTRUCTION }] },
                ...history
            ]
        });

        const output = response.text.trim();

        // Intentar extraer JSON
        let jsonStr = output;
        const codeBlock = output.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
            jsonStr = codeBlock[1].trim();
        }
        
        const parsed = JSON.parse(jsonStr);

        // Si el ticket está completo, eliminamos la sesión para el próximo pedido
        if (parsed.isComplete) {
            console.log(`[Gemini] Ticket completado para ${from}. Limpiando sesión.`);
            sessions.delete(from);
        } else {
            // Si no está completo, guardamos la respuesta del modelo en el historial para mantener el contexto
            history.push({ role: 'model', parts: [{ text: output }] });
        }

        console.log('[Gemini] Análisis con memoria completado.');
        return parsed;
    } catch (err) {
        console.error('[Gemini] Error en analyzeMessage:', err.message);
        return { error: err.message || 'parse_error' };
    }
}

module.exports = { analyzeMessage };
