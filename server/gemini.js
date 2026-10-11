// Gemini-backed request classification.
//
// The keyword engine could only recognise words someone had thought to write
// down. "I want a sandwich" matched nothing and fell through to a nurse --
// exactly the bottleneck this product exists to remove. A language model
// understands the request instead of pattern-matching it.
//
// What is deliberately NOT delegated to the model:
//   * Clinical red flags run locally, first, and never reach the network.
//     An emergency must not depend on an API call succeeding.
//   * The chart guardrails (NPO, dysphagia, fall risk) stay local -- they
//     depend on the patient record, which is not sent here.
//   * If the model is slow, down, or returns something unusable, the keyword
//     engine still answers.
//
// No patient identity is sent to Google: only the words of the request.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 6000);

export const CATEGORY_IDS = [
  'urgent_clinical',
  'clinical',
  'mobility',
  'dietary',
  'room_environment',
  'comfort',
  'tech_amenities',
  'admin',
  'unclassified',
];

const SYSTEM_PROMPT = `You are the triage router for an inpatient hospital call-bell system on an
elderly medical-surgical floor. You read what a patient asked for and choose exactly one category.

Most call bells are NOT clinical. Your job is to get ordinary hospitality requests to the right
service team so nurses are not interrupted for them. Classify confidently: an everyday request
for food, drink, bedding, cleaning or the TV should never go to a nurse.

Categories:
- urgent_clinical: possible medical emergency or acute change. Chest pain, trouble breathing,
  dizziness, fainting, bleeding, a fall, numbness, confusion, allergic reaction, surgical wound
  or incision problems, IV or drain problems, severe or sudden pain. ALWAYS choose this when in
  any doubt about safety.
- clinical: a nurse is needed but it is not an emergency. Pain medication, routine medicine
  timing, nausea, itching, a dressing change, oxygen, catheter, questions about their treatment.
- mobility: physical help moving. Getting to the bathroom or toilet, a bedpan or urinal, getting
  out of bed, sitting up, repositioning, help walking.
- dietary: anything to eat or drink. Water, ice, juice, coffee, tea, a snack, a sandwich, soup,
  fruit, a meal or tray, cutlery, a straw, a refill. Any named food or drink belongs here.
- room_environment: the room itself. Too hot or cold, temperature, cleaning, a spill, rubbish,
  a dirty bathroom or floor, bad smell, mopping.
- comfort: linens and personal comfort items. Blanket, pillow, sheets, towel, washcloth, gown,
  socks.
- tech_amenities: devices and fittings. TV, remote, channels, volume, telephone, wifi, tablet,
  charger, power socket, lights, blinds, curtains.
- admin: questions and logistics. When the doctor is coming, discharge, paperwork, visitors,
  an interpreter, chaplain, social work.
- unclassified: genuinely unintelligible, empty, or not a request at all. Use this ONLY when you
  cannot tell what is being asked. Do not use it for an ordinary request you simply find unusual.

Rules:
1. Safety first. Any hint of a medical symptom outranks any hospitality words in the same
   sentence. "Some juice please, and my chest hurts" is urgent_clinical.
2. A named food or drink is dietary, even if you do not recognise the dish.
3. Only use unclassified for genuine nonsense. A clear request must be routed.
4. Patients may speak English or Spanish. Treat both identically.
5. confidence is your own 0-1 estimate that the category is right.
6. reasoning is at most 12 words, for a nurse manager auditing the decision.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: CATEGORY_IDS },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['category', 'confidence', 'reasoning'],
};

export const geminiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

/**
 * Classify one request with Gemini.
 * Returns null on any failure so the caller can fall back to the rules engine.
 */
export async function classifyWithGemini(text, { signal } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !text?.trim()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener?.('abort', () => controller.abort());

  const started = Date.now();
  try {
    const response = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `Patient said: "${text}"` }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
        safetySettings: [
          // Clinical language (bleeding, pain, wounds) must not be filtered out
          // of a medical triage tool.
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    if (!response.ok) return null;

    const body = await response.json();
    const raw = body?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    if (!raw.trim()) return null;

    const parsed = JSON.parse(raw);
    if (!CATEGORY_IDS.includes(parsed.category)) return null;

    return {
      categoryId: parsed.category,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      reasoning: String(parsed.reasoning || '').slice(0, 160),
      latencyMs: Date.now() - started,
    };
  } catch {
    return null; // timeout, network, bad JSON -- the caller falls back
  } finally {
    clearTimeout(timer);
  }
}
