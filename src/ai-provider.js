const config = require('./config');

async function requestGemini(prompt, generationConfig = {}) {
  if (config.aiProvider !== 'gemini' || !config.aiApiKey) return null;
  const endpoint = `${config.aiBaseUrl}/models/${encodeURIComponent(config.aiModel)}:generateContent?key=${encodeURIComponent(config.aiApiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 1600, ...generationConfig } }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim() || null;
  } catch { return null; } finally { clearTimeout(timeout); }
}

async function generateText(prompt) { return requestGemini(prompt); }

async function generateJson(prompt) {
  const text = await requestGemini(`${prompt}\nResponda somente com JSON válido, sem bloco markdown.`, { responseMimeType: 'application/json' });
  if (!text) return null;
  try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')); } catch { return null; }
}

module.exports = { generateText, generateJson };
