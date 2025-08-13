// src/app/api/chat/route.ts
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type Msg = { role: 'user' | 'assistant'; content: string };

/* -------------------------- helpers -------------------------- */

function windowMessages(messages: Msg[], maxChars = 9000) {
  const trimmed: Msg[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    total += (m.content || '').length;
    trimmed.unshift(m);
    if (total > maxChars) break;
  }
  return trimmed;
}

function latestUserText(messages: Msg[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content || '';
  }
  return '';
}

// Deterministic language detection
async function detectUserLang(text: string): Promise<{ code: string; name: string }> {
  if (!text.trim()) return { code: 'en', name: 'English' };
  const det = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'Return ONLY JSON like {"code":"xx","name":"LanguageName"} with ISO 639-1 code for the dominant language of the user text.',
      },
      { role: 'user', content: text.slice(0, 2000) },
    ],
    response_format: { type: 'json_object' as const },
  });

  try {
    const raw = det.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(raw);
    const code = String(parsed.code || '').toLowerCase();
    const name = String(parsed.name || '');
    if (code && name) return { code, name };
  } catch {}
  return { code: 'en', name: 'English' };
}

// One-time banner translated to the user's language
async function translateOneTimeBanner(targetLangName: string) {
  const englishBanner =
    "No problem — we can continue in your language. When you're ready to write the letter, I'll produce it in English for your landlord and include a translation in your language.\n\nI use the latest Housing Ombudsman Code, legislation, and regulatory guidance (including 2024 updates), so my answers are based on the most up‑to‑date information from official sources you can verify.";
  const tr = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Translate the following into ${targetLangName}. Keep it polite, concise, neutral. Return only the translated text.`,
      },
      { role: 'user', content: englishBanner },
    ],
  });
  return (tr.choices[0]?.message?.content || englishBanner).trim();
}

/* -------------------------- handler -------------------------- */

export async function POST(req: NextRequest) {
  // Expect JSON: { messages, draft }
  const body = await req.json().catch(() => ({}));
  const messages: Msg[] = Array.isArray(body.messages) ? body.messages : [];
  const draft: boolean = Boolean(body.draft); // false = CHAT phase, true = LETTER phase

  const history = windowMessages(messages);
  const latest = latestUserText(history);

  // Detect language of latest user message
  const { code: userLangCode, name: userLangName } = await detectUserLang(latest);
  const isEnglish = userLangCode === 'en';

  // Show the translated banner exactly once: only if not English AND this is the first assistant reply
  const assistantCount = history.filter((m) => m.role === 'assistant').length;
  const shouldPrependBanner = !isEnglish && assistantCount === 0;

  // Base guidance
  const systemBase = `
You are the "Complaint Letter Helper" for residents in England.

POLICY ABOUT SOURCES & FRESHNESS
- Never mention training data cutoffs.
- If the user asks how current your info is, reply IN UserLang:
  "I use the latest Housing Ombudsman Code, legislation, and regulatory guidance (including 2024 updates), so my answers are based on the most up‑to‑date information from official sources you can verify."

DETECTED_USER_LANGUAGE
- UserLangCode: ${userLangCode}
- UserLangName: ${userLangName}
- IsEnglish: ${isEnglish ? 'true' : 'false'}

GENERAL
- Be accurate, concise, and resident-friendly. Avoid legalese and do not invent policy or law.
`.trim();

  /* ---------------------- CHAT phase (stream raw) ---------------------- */
  if (!draft) {
    const system = `
${systemBase}

PHASE: CHAT (draft=false)
- Converse in the user's language (UserLang). Mirror their language.
- Do NOT add any banner yourself; the server injects it once when appropriate.
- Ask at most ONE focused question at a time if essential.
- Do NOT draft the letter yet (no subject line, no formal sign-off).
`.trim();

    const modelStream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Conversation phase: CHAT; UserLang=${userLangCode} (${userLangName}); IsEnglish=${isEnglish}` },
        ...history,
      ],
      stream: true,
    });

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          if (shouldPrependBanner) {
            const translated = await translateOneTimeBanner(userLangName);
            controller.enqueue(encoder.encode(translated + '\n\n'));
          }
          for await (const chunk of modelStream) {
            const delta = chunk.choices?.[0]?.delta?.content || '';
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } catch {
          controller.enqueue(encoder.encode('\n\n[Error generating response]\n'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  /* ---------------------- LETTER phase (JSON → stitched) ---------------------- */

  // Professional UK letter layout requirements (both plain & markdown variants)
  const jsonSystem = `
${systemBase}

PHASE: LETTER (draft=true)
- If an essential detail is missing, set "intro" to ONE short question in UserLang; otherwise a short confirmation. Still produce the letter.
- Output ONLY valid JSON (no Markdown code fences) with these fields:
  {
    "intro": "ONE short sentence in UserLang.",
    "letter_en_text": "A professional UK letter in PLAIN TEXT. Include: current date (UK format, e.g., 13 August 2025), recipient block (use provided name/address if available; otherwise leave those lines blank or use placeholders like '[Landlord name]' if not supplied by user), subject line starting with 'Subject:', a clear body, and a polite closing with sender details placeholders if unknown. No markdown or asterisks.",
    "letter_en_markdown": "The SAME letter as 'letter_en_text' but formatted in MARKDOWN with **bold** for Subject line label ('Subject:'), optional headings (e.g., **Formal Complaint**), and sender name in bold. Keep line breaks and spacing suitable for pasting into email/Word.",
    "footer": "ONE short sentence in UserLang explaining they can ask for edits.",
    ${isEnglish ? '' : `"letter_translation_text": "Faithful translation of the English letter into ${userLangName}, plain text only.",
    "letter_translation_markdown": "The SAME as 'letter_translation_text' but with the same markdown emphasis as the English markdown (e.g., **Subject:** etc.), translated."`}
  }

STRICT LAYOUT GUIDANCE FOR THE LETTER (both plain & markdown):
- Top-right or top-left: Date in UK long format (e.g., 13 August 2025).
- Recipient block (top-left): Landlord/organization name and address on separate lines. If the user did not provide them, leave blank lines or placeholders (e.g., "[Landlord name]").
- After a blank line: **Subject:** <short subject>.
- Greeting: "Dear <Landlord name>," (or "Dear Sir/Madam," if unknown).
- Body: concise paragraphs with dates/issues/prior contacts, health/safety concern if relevant, and requested remedy. Use clear, plain English.
- Timescale: request a reasonable timeframe (e.g., "within 14 days").
- Closing: "Yours sincerely," (if named recipient) or "Yours faithfully," (if generic) then sender’s name and contact lines (use placeholders if unknown).
- No legalese. No code fences. Do not invent an address.

Return JSON only.
`.trim();

  const jsonCompletion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      { role: 'system', content: jsonSystem },
      { role: 'user', content: `Conversation phase: LETTER; UserLang=${userLangCode} (${userLangName}); IsEnglish=${isEnglish}` },
      ...history,
    ],
    response_format: { type: 'json_object' as const },
  });

  // Parse JSON safely
  let intro = '';
  let footer = '';
  let letterText = '';
  let letterMD = '';
  let trText = '';
  let trMD = '';

  try {
    const raw = jsonCompletion.choices[0]?.message?.content || '{}';
    const data = JSON.parse(raw);
    intro = String(data.intro || '').trim();
    footer = String(data.footer || '').trim();
    letterText = String(data.letter_en_text || '').trim();
    letterMD = String(data.letter_en_markdown || '').trim();
    if (!isEnglish) {
      trText = String(data.letter_translation_text || '').trim();
      trMD = String(data.letter_translation_markdown || '').trim();
    }
  } catch {
    const msg = 'Sorry — I had trouble preparing the letter. Please try again.';
    return new Response(msg, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // Stitch into tags your UI can parse
  const out: string[] = [];
  if (intro) out.push(intro);

  if (letterText) {
    out.push('');
    out.push('<<LETTER_EN>>');
    out.push(letterText);
    out.push('<</LETTER_EN>>');
  }
  if (letterMD) {
    out.push('');
    out.push('<<LETTER_EN_MD>>');
    out.push(letterMD);
    out.push('<</LETTER_EN_MD>>');
  }

  if (!isEnglish && trText) {
    out.push('');
    out.push(`<<LETTER_TRANSLATION lang="${userLangName}">>`);
    out.push(trText);
    out.push('<</LETTER_TRANSLATION>>');
  }
  if (!isEnglish && trMD) {
    out.push('');
    out.push(`<<LETTER_TRANSLATION_MD lang="${userLangName}">>`);
    out.push(trMD);
    out.push('<</LETTER_TRANSLATION_MD>>');
  }

  if (footer) {
    out.push('');
    out.push(footer);
  }

  const stitched = out.join('\n');

  // Stream the stitched text
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        if (shouldPrependBanner) {
          const translated = await translateOneTimeBanner(userLangName);
          controller.enqueue(encoder.encode(translated + '\n\n'));
        }
        controller.enqueue(encoder.encode(stitched));
      } catch {
        controller.enqueue(encoder.encode('\n\n[Error generating response]\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}