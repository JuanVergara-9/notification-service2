'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const SYSTEM_INSTRUCTION = `Eres el asistente de miservicio.ar. Tu función es recibir un pedido por WhatsApp y extraer los datos en formato JSON estricto. Categorías válidas: Plomería, Electricidad, Reparación de Electrodomésticos, Limpieza, Climatización. Si el mensaje no es un pedido, responde { "error": "not_a_service" }. Si es un pedido, responde: { "category": "string", "description": "string", "urgency": "low"|"medium"|"high" }. Responde únicamente con el JSON, sin texto adicional.`;

/**
 * Analiza un mensaje de texto con Gemini y extrae categoría, descripción y urgencia si es un pedido.
 * @param {string} text - Mensaje entrante (ej. desde WhatsApp)
 * @returns {Promise<{ category?: string, description?: string, urgency?: string, error?: string }>}
 */
async function analyzeMessage(text) {
    if (!genAI) {
        console.error('[Gemini] GEMINI_API_KEY no configurada.');
        return { error: 'ai_not_configured' };
    }
    if (!text || typeof text !== 'string') {
        return { error: 'not_a_service' };
    }

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: SYSTEM_INSTRUCTION
        });

        const result = await model.generateContent(text);
        const response = result.response;
        const output = response.text().trim();

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
