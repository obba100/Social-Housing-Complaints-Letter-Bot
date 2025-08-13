import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: 'No audio' }, { status: 400 });
  }
  const file = new File([audio], 'note.webm', { type: (audio as any).type || 'audio/webm' });

  const out = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1'
  });

  return NextResponse.json({ text: out.text || '' });
}