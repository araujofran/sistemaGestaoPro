const config = require('./config');

async function generateText(prompt) {
  if (config.aiProvider !== 'gemini' || !config.aiApiKey) return null;
  const endpoint = `${config.aiBaseUrl}/models/${encodeURIComponent(config.aiModel)}:generateContent?key=${encodeURIComponent(config.aiApiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 1200 } }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim() || null;
  } catch { return null; } finally { clearTimeout(timeout); }
}

module.exports = { generateText };
