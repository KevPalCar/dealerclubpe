// ============================================================
// Cerebro del agente — capa model-agnostic
// ------------------------------------------------------------
// Carga el system prompt desde knowledge/cerebro.md y llama al
// proveedor configurado (Gemini o Claude). Cambiar de proveedor
// es solo cambiar LLM_PROVIDER + LLM_API_KEY; el resto del
// código no cambia.
// ============================================================
const fs = require("fs");
const path = require("path");
const logger = require("firebase-functions/logger");
const { LLM_API_KEY, LLM_PROVIDER, LLM_MODEL } = require("./config");
const { getCatalogoTexto } = require("./catalog");
const { getBotSettings } = require("./botsettings");

let SYSTEM_PROMPT = null;
function getSystemPrompt() {
  if (SYSTEM_PROMPT === null) {
    const p = path.join(__dirname, "..", "knowledge", "cerebro.md");
    SYSTEM_PROMPT = fs.readFileSync(p, "utf8");
  }
  return SYSTEM_PROMPT;
}

// System prompt + catálogo en vivo + contexto temporal (Lima).
// `extra`: instrucciones puntuales para un mensaje (p. ej. el modo seguimiento).
async function buildSystem(extra = "") {
  const fecha = new Date().toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  // Precios/horarios reales, leídos del mismo sitio que edita el admin.
  const catalogo = await getCatalogoTexto();
  // Aprendizajes que Kevin aprobó desde el admin tras revisar chats reales.
  const { notes } = await getBotSettings();
  return (
    getSystemPrompt() +
    (catalogo ? `\n\n${catalogo}` : "") +
    (notes
      ? `\n\n## Aprendizajes aprobados (ajustes que mandan sobre el estilo general)\n${notes}`
      : "") +
    (extra ? `\n\n${extra.trim()}` : "") +
    `\n\n## Contexto temporal\nHoy es ${fecha} (hora de Lima). Es solo referencia; NO propongas días ni fechas concretas al cliente.`
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// history: array de { role: "user"|"assistant", text }
async function generateReply(history, { extra = "" } = {}) {
  const provider = (LLM_PROVIDER.value() || "gemini").toLowerCase();
  const apiKey = LLM_API_KEY.value();
  if (!apiKey) throw new Error("Falta LLM_API_KEY");

  if (provider === "claude") {
    return withRetries(() => callClaude(history, apiKey, extra));
  }

  // Gemini: cadena de modelos. Si el primero se satura (503) o topa cuota
  // (429), prueba con el siguiente antes de rendirse.
  const forced = LLM_MODEL.value();
  const modelos = forced ? [forced] : ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  let lastErr;
  for (const model of modelos) {
    try {
      return await withRetries(() => callGemini(history, apiKey, model, extra));
    } catch (err) {
      lastErr = err;
      const transitorio = /\b(429|503)\b/.test(err.message || "");
      if (!transitorio) break; // error no transitorio: no tiene sentido cambiar de modelo
    }
  }
  throw lastErr;
}

// Reintenta una llamada ante errores transitorios (429 cuota / 503 saturado).
async function withRetries(fn) {
  let lastErr;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transitorio = /\b(429|503)\b/.test(err.message || "");
      if (!transitorio || intento === 1) break;
      await sleep(600 * (intento + 1));
    }
  }
  throw lastErr;
}

// --- Gemini (Google AI Studio) ------------------------------
async function callGemini(history, apiKey, model, extra) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  const payload = {
    systemInstruction: { parts: [{ text: await buildSystem(extra) }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800,
      // gemini-2.5-flash "piensa" por defecto y eso gasta tokens de salida
      // (corta la respuesta). Lo desactivamos: para chat no hace falta.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Error Gemini", { status: res.status, data });
    throw new Error(`Gemini failed: ${res.status}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return (text || "").trim();
}

// --- Claude (Anthropic) -------------------------------------
async function callClaude(history, apiKey, extra) {
  const model = LLM_MODEL.value() || "claude-haiku-4-5-20251001";
  const url = "https://api.anthropic.com/v1/messages";

  const messages = history.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.text,
  }));

  const payload = {
    model,
    max_tokens: 600,
    temperature: 0.7,
    system: await buildSystem(extra),
    messages,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Error Claude", { status: res.status, data });
    throw new Error(`Claude failed: ${res.status}`);
  }
  const text = data?.content?.[0]?.text;
  return (text || "").trim();
}

// --- Análisis (no es una respuesta al cliente) ----------------
// Pide al modelo un JSON a partir de un encargo y un texto. Lo usa el
// informe semanal de chats. Devuelve el objeto, o lanza si no es JSON.
async function generateJson(encargo, texto) {
  const apiKey = LLM_API_KEY.value();
  if (!apiKey) throw new Error("Falta LLM_API_KEY");
  let lastErr;
  for (const model of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
    try {
      return await withRetries(async () => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: encargo }] },
            contents: [{ role: "user", parts: [{ text: texto }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 4000,
              responseMimeType: "application/json",
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          logger.error("Error Gemini (análisis)", { status: res.status, data });
          throw new Error(`Gemini failed: ${res.status}`);
        }
        return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports = { generateReply, generateJson, getSystemPrompt };
