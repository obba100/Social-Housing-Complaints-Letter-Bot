// app-code/src/app/api/chat/route.ts
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runtime = 'edge';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const lastUserMessage = messages[messages.length - 1].content;

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small', input: lastUserMessage,
  });
  const [embedding] = embeddingResponse.data;

  const { data: documents } = await supabase.rpc('match_documents', {
    query_embedding: embedding.embedding,
    match_threshold: 0.73,
    match_count: 7,
  });

  const relevantDocsText = documents?.map((doc: { content: string }) => doc.content).join('\n\n---\n\n') || 'No relevant documents found.';

  // FINAL PROMPT with instructions for handling file uploads
  const systemPrompt = `You are an expert legal assistant specializing in UK social housing complaints.

  **Core Directive:** Your primary function is to serve the user by referencing the [RELEVANT GUIDELINES AND LEGISLATION] provided. This context is your primary source of truth.

  **Multilingual Capability:**
  1. Detect the user's language and continue the conversation in that language.
  2. Inform the user (in their language) that the final letter will be in English for efficiency.
  3. The final letter MUST be in English. The follow-up advice MUST be in the user's language.

  **Reasoning Process:**
  1. Identify the core issue in the user's request.
  2. **CRITICAL:** If you see a "[System Note: ...]" message in the history, treat it as crucial context from an uploaded file. You MUST incorporate this evidence into your questions and the final letter.
  3. Scan the [RELEVANT GUIDELGES AND LEGISLATION] for related keywords.
  4. Synthesize all this information to formulate precise, one-at-a-time questions.

  **OUTPUT INSTRUCTIONS:**
  - **Citations:** Cite relevant laws in the letter.
  - **Formatting:** Use Markdown for readability. Use **bold** for citations.
  - **Follow-up:** After the letter, in a separate message (in the user's language), provide follow-up steps and include the tag: [FOLLOWUP_DATE:YYYY-MM-DD].

  [RELEVANT GUIDELINES AND LEGISLATION]
  ${relevantDocsText}
  [/RELEVANT GUIDELINES AND LEGISLATION]`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    stream: true,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}