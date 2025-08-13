'use client';

import React, { useEffect, useRef, useState } from 'react';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  meta?: { letter?: 'en' | 'translation'; md?: string; langLabel?: string };
};
type AnySR = any;

/* ---------------- Letter parsing & Copy helpers ---------------- */

const extractLetterBlocks = (text: string) => {
  const enMatch = text.match(/<<LETTER_EN>>([\s\S]*?)<<\/LETTER_EN>>/);
  const trMatch = text.match(/<<LETTER_TRANSLATION(?:[^>]*)>>([\s\S]*?)<<\/LETTER_TRANSLATION>>/);

  const enMDMatch = text.match(/<<LETTER_EN_MD>>([\s\S]*?)<<\/LETTER_EN_MD>>/);
  const trMDMatch = text.match(/<<LETTER_TRANSLATION_MD(?:\s+lang="([^"]+)")?\s*>>([\s\S]*?)<<\/LETTER_TRANSLATION_MD>>/);

  // Try to read lang from either translation tag
  let translationLang = '';
  const trLangFromPlain = text.match(/<<LETTER_TRANSLATION\s+lang="([^"]+)"\s*>>/);
  const trLangFromMD = text.match(/<<LETTER_TRANSLATION_MD\s+lang="([^"]+)"\s*>>/);
  if (trLangFromMD && trLangFromMD[1]) translationLang = trLangFromMD[1];
  else if (trLangFromPlain && trLangFromPlain[1]) translationLang = trLangFromPlain[1];
  else if (trMDMatch && trMDMatch[1]) translationLang = trMDMatch[1];

  // Anything before the English letter (e.g., a quick clarifier)
  const before = enMatch ? text.slice(0, enMatch.index).trim() : '';

  // Determine the last closing tag position to compute "after"
  const closePositions = [
    enMatch ? enMatch.index! + enMatch[0].length : -1,
    trMatch ? trMatch.index! + trMatch[0].length : -1,
    enMDMatch ? enMDMatch.index! + enMDMatch[0].length : -1,
    trMDMatch ? trMDMatch.index! + trMDMatch[0].length : -1
  ].filter((n) => n >= 0);

  let after = '';
  if (closePositions.length === 0) {
    after = !enMatch ? text.trim() : '';
  } else {
    const lastClose = Math.max(...closePositions);
    after = text.slice(lastClose).trim();
  }

  return {
    before: before || '',
    english: enMatch ? enMatch[1].trim() : '',
    englishMD: enMDMatch ? enMDMatch[1].trim() : '',
    translation: trMatch ? trMatch[1].trim() : '',
    translationMD: trMDMatch ? trMDMatch[2].trim() : '',
    translationLang: translationLang || '',
    after: after || ''
  };
};

const CopyButton: React.FC<{ text: string; label?: string; className?: string; variant?: 'primary' | 'secondary' }> = ({
  text,
  label = 'Copy',
  className,
  variant = 'secondary'
}) => {
  const [done, setDone] = useState(false);
  const base =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 border border-blue-600'
      : 'border border-blue-200 bg-white text-blue-900 hover:bg-blue-50';
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
      className={[
        'rounded-md px-2 py-1 text-xs transition active:scale-[0.98]',
        base,
        className || ''
      ].join(' ')}
      aria-label="Copy to clipboard"
    >
      {done ? 'Copied' : label}
    </button>
  );
};

/* -------- very small Markdown renderer (bold + line breaks) --------
   We only need **bold** and preserved line breaks/spacing for letters. */
function renderMarkdown(md: string): React.ReactNode {
  // Split by **bold**, keep delimiters
  const segments = md.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {segments.map((seg, i) => {
        const m = seg.match(/^\*\*([^*]+)\*\*$/);
        if (m) {
          return <strong key={i}>{m[1]}</strong>;
        }
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

/* -------------------- Main component -------------------- */

export default function Chat() {
  // Conversation state (anonymous, in-tab only)
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Streaming UI state
  const [isStreaming, setIsStreaming] = useState(false);

  // Refs
  const recognitionRef = useRef<AnySR | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Prefer on-device speech recognition (fast + free)
  useEffect(() => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.lang = 'en-GB';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e: SpeechRecognitionEvent) => {
        const t = Array.from(e.results).map((r) => r[0].transcript).join(' ');
        setInput(t);
      };
      rec.onend = () => setIsRecording(false);
      recognitionRef.current = rec;
    }
  }, []);

  // OpenAI-style mic icon
  const MicIcon = ({ className = '' }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
      <path fill="currentColor" d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 14 0h-2z" />
      <path d="M12 17v4m-4 0h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  const startRecording = async () => {
    if (recognitionRef.current) {
      setIsRecording(true);
      recognitionRef.current.start();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = async () => {
      setIsTranscribing(true);
      try {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const fd = new FormData();
        fd.append('audio', blob, 'note.webm');
        const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
        const data = await res.json();
        if (data?.text) setInput(data.text);
      } catch {}
      setIsTranscribing(false);
      setIsRecording(false);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recognitionRef.current && isRecording) {
      recognitionRef.current.stop();
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // Core send (CHAT phase)
  const send = async () => {
    await sendWithPhase(false);
  };

  // Letter drafting action (LETTER phase)
  const writeLetter = async () => {
    await sendWithPhase(true);
  };

  // Shared sender with phase control
  const sendWithPhase = async (draft: boolean) => {
    const text = input.trim();
    if (draft === false && !text) return; // in chat mode, require text
    if (isStreaming) return;

    const nextMessages: Msg[] = text ? [...messages, { role: 'user', content: text }] : [...messages];

    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);

    // create streaming assistant bubble now
    const holderIndex = nextMessages.length; // next position
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    let res: Response | null = null;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, draft }), // <— phase flag
      });
    } catch (e: any) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[holderIndex] = { role: 'assistant', content: `[Network error] ${String(e?.message || e)}` };
        return updated;
      });
      setIsStreaming(false);
      return;
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      setMessages((prev) => {
        const updated = [...prev];
        updated[holderIndex] = { role: 'assistant', content: `[Error ${res.status}] ${errText || 'Problem generating a response.'}` };
        return updated;
      });
      setIsStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';

    // stream into the placeholder
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });

      setMessages((prev) => {
        const updated = [...prev];
        if (updated[holderIndex]?.role === 'assistant') {
          updated[holderIndex] = { role: 'assistant', content: acc };
        }
        return updated;
      });
    }

    // After stream completes, if it contains a letter, split it into separate bubbles
    const parsed = extractLetterBlocks(acc);
    if (parsed.english || parsed.englishMD || parsed.translation || parsed.translationMD) {
      setMessages((prev) => {
        const before = parsed.before ? [{ role: 'assistant', content: parsed.before } as Msg] : [];
        const englishCard = (parsed.english || parsed.englishMD)
          ? [{
              role: 'assistant',
              content: parsed.english || '', // plain text (for Copy Plain)
              meta: { letter: 'en', md: parsed.englishMD || '' }
            } as Msg]
          : [];
        const translationCard = (parsed.translation || parsed.translationMD)
          ? [{
              role: 'assistant',
              content: parsed.translation || '', // plain text
              meta: { letter: 'translation', md: parsed.translationMD || '', langLabel: parsed.translationLang || undefined }
            } as Msg]
          : [];
        const after = parsed.after ? [{ role: 'assistant', content: parsed.after } as Msg] : [];

        const updated = [...prev];
        // Replace the placeholder at holderIndex with the split blocks:
        updated.splice(holderIndex, 1, ...before, ...englishCard, ...translationCard, ...after);
        return updated;
      });
    }

    setIsStreaming(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const TypingDots = () => (
    <div className="flex items-center gap-1 text-gray-500">
      <span className="inline-block w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="inline-block w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '120ms' }} />
      <span className="inline-block w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '240ms' }} />
    </div>
  );

  /* --------------------------- UI --------------------------- */

  // Letter “card” bubble with Rich display + Copy buttons (Rich primary, Plain secondary)
  const LetterBubble: React.FC<{ title: string; text: string; md?: string }> = ({ title, text, md }) => (
    <div className="mb-3 sm:mb-4 flex justify-start">
      <div className="max-w-[85%] sm:max-w-[75%] rounded-xl overflow-hidden border border-blue-100 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-blue-100 bg-blue-50 px-3 py-2">
          <div className="text-sm font-medium text-blue-900">{title}</div>
          <div className="flex items-center gap-2">
            {md && md.trim() !== '' ? (
              <>
                <CopyButton text={md} label="Copy Rich" variant="primary" />
                <CopyButton text={text || md} label="Copy Plain" variant="secondary" />
              </>
            ) : (
              <CopyButton text={text} label="Copy" variant="primary" />
            )}
          </div>
        </div>
        <div className="px-3 py-3">
          {/* RENDER RICH if available; else plain */}
          {md && md.trim() !== '' ? (
            <div className="whitespace-pre-wrap leading-relaxed text-[0.95rem] text-gray-900">
              {renderMarkdown(md)}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap leading-relaxed text-[0.95rem] text-gray-900">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-[#f0f6ff]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#f0f6ff]/80 backdrop-blur border-b border-blue-100">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <h1 className="text-lg md:text-xl font-semibold text-blue-900">Complaint Letter Helper</h1>
          <p className="text-xs md:text-sm text-blue-800/70">
            Chat in your own language. When you’re ready, click “Write the letter” — we’ll give it in English with a translation.
          </p>
        </div>
      </header>

      {/* Chat panel */}
      <main className="max-w-3xl mx-auto px-2 sm:px-4">
        <div className="mt-4 sm:mt-6 mb-32 bg-white/90 border border-blue-100 rounded-xl shadow-sm">
          {/* Messages */}
          <div className="h-[64vh] sm:h-[70vh] overflow-y-auto p-3 sm:p-4">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-center text-sm text-blue-900/70 px-6">
                Tell me what happened, or tap the mic to speak. Include dates, who you spoke to, and what outcome you want.
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              const isLetterEn = m.meta?.letter === 'en';
              const isLetterTr = m.meta?.letter === 'translation';

              if (isLetterEn)
                return <LetterBubble key={i} title="Letter (English)" text={m.content} md={m.meta?.md} />;

              if (isLetterTr) {
                const lang = m.meta?.langLabel ? ` – ${m.meta.langLabel}` : '';
                return <LetterBubble key={i} title={`Letter (Translation${lang})`} text={m.content} md={m.meta?.md} />;
              }

              return (
                <div key={i} className={`mb-3 sm:mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={[
                      'max-w-[85%] sm:max-w-[75%] px-3 py-2 sm:px-4 sm:py-3 rounded-2xl text-[0.95rem] leading-relaxed whitespace-pre-wrap',
                      isUser ? 'bg-blue-100 text-blue-950 rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                    ].join(' ')}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}

            {isStreaming && (
              <div className="mb-3 sm:mb-4 flex justify-start">
                <div className="bg-gray-100 text-gray-900 rounded-2xl rounded-bl-sm px-3 py-2 sm:px-4 sm:py-3">
                  <TypingDots />
                </div>
              </div>
            )}

            {isTranscribing && !isStreaming && (
              <div className="mb-3 sm:mb-4 flex justify-start">
                <div className="bg-gray-100 text-gray-900 rounded-2xl rounded-bl-sm px-3 py-2 sm:px-4 sm:py-3">
                  <span className="text-gray-500">Transcribing…</span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="sticky bottom-0 border-t border-blue-100 bg-white/95 backdrop-blur rounded-b-xl">
            <div className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3">
              {/* Mic with clear on/off states */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                aria-pressed={isRecording}
                title={isRecording ? 'Stop recording' : 'Start recording'}
                className={[
                  'relative rounded-full w-11 h-11 sm:w-12 sm:h-12 border transition',
                  isRecording
                    ? 'bg-blue-600 border-blue-600 text-white shadow-[0_0_0_4px_rgba(37,99,235,0.15)] animate-pulse'
                    : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                ].join(' ')}
              >
                <MicIcon className="w-5 h-5 mx-auto" />
                {isRecording && <span className="pointer-events-none absolute inset-0 rounded-full ring-8 ring-blue-300/30" />}
              </button>

              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Write here…"
                className="flex-1 border border-blue-200 bg-white rounded-xl px-3 sm:px-4 py-2 sm:py-3 outline-none focus:ring-2 focus:ring-blue-300 text-[0.95rem]"
              />

              {/* Primary send */}
              <button
                onClick={send}
                disabled={isStreaming || input.trim().length === 0}
                className={[
                  'rounded-xl px-3 sm:px-4 py-2 sm:py-3 text-white',
                  isStreaming || input.trim().length === 0
                    ? 'bg-blue-300 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition'
                ].join(' ')}
              >
                Send
              </button>

              {/* Write the letter */}
              <button
                onClick={writeLetter}
                disabled={isStreaming}
                className="rounded-xl px-3 sm:px-4 py-2 sm:py-3 border border-blue-300 text-blue-800 hover:bg-blue-50 transition"
                title="Draft the final letter (English with translation)"
              >
                Write the letter
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}