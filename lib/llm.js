// lib/llm.js
// Groq AI wrapper (safe for Intercom - works even without API key)

export function createLLM() {
  const apiKey = process.env.GROQ_API_KEY;

  // kalau belum ada API → tetap jalan
  if (!apiKey) return null;

  const baseURL = "https://api.groq.com/openai/v1";
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  async function json(system, user) {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: system + "\nReturn ONLY JSON."
          },
          {
            role: "user",
            content: user
          }
        ]
      })
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "{}";

    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  return { json };
}
