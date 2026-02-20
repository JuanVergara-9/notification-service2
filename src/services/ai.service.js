'use strict';

const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY;
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

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
 * Flujo actual del bot: Recibe mensaje → Llama a Gemini → Loguea el resultado → Responde por WhatsApp.
 *
 * Analiza un mensaje de texto con Gemini para recolectar datos del pedido.
 * @param {string} text - Mensaje entrante (ej. desde WhatsApp)
 * @returns {Promise<{ isComplete: boolean, extractedData: object, replyToClient: string, error?: string }>}
 */
async function analyzeMessage(text) {
    if (!client) {
        console.error('[Gemini] GEMINI_API_KEY no configurada.');
        return { error: 'ai_not_configured' };
    }
    if (!text || typeof text !== 'string') {
        return { error: 'not_a_service' };
    }

    try {
        const response = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: SYSTEM_INSTRUCTION + '\n\nMensaje a analizar: ' + text
        });

        const output = response.text.trim();

        // Intentar extraer JSON (puede venir envuelto en ```json ... ```)
        let jsonStr = output;
        const codeBlock = output.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
            jsonStr = codeBlock[1].trim();
        }
        const parsed = JSON.parse(jsonStr);
        console.log('[Gemini] Análisis completado.');
        return parsed;
    } catch (err) {
        console.error('[Gemini] Error en analyzeMessage:', err.message);
        return { error: err.message || 'parse_error' };
    }
}

module.exports = { analyzeMessage };
