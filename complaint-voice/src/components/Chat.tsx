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
  const trMDMatch = text.match(
    /<<LETTER_TRANSLATION_MD(?:\s+lang="([^"]+)")?\s*>>([\s\S]*?)<<\/LETTER_TRANSLATION_MD>>/
  );

  // Try to read lang from either translation tag
  let translationLang = '';
  const trLangFromPlain = text.match(/<<LETTER_TRANSLATION\s+lang="([^"]+)"\s*>>/);
  const trLangFromMD = text.match(/<<LETTER_TRANSLATION_MD\s+lang="([^"]+)"\s*>>/);
  if (trLangFromMD && trLangFromMD[1]) translationLang = trLangFromMD[1];
  else if (trLangFromPlain && trLangFromPlain[1]) translationLang = trLangFromPlain[1];
  else if (trMDMatch && trMDMatch[1]) translationLang = trMDMatch[1];

  const before = enMatch ? text.slice(0, enMatch.index).trim() : '';

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

const CopyButton: React.FC<{
  text: string;
  label?: string;
  className?: string;
  variant?: 'primary' | 'secondary';
}> = ({ text, label = 'Copy', className, variant = 'secondary' }) => {
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
        'rounded-full px-3 py-1 text-xs transition active:scale-[0.98] shadow-sm',
        base,
        className || ''
      ].join(' ')}
      aria-label="Copy to clipboard"
    >
      {done ? 'Copied' : label}
    </button>
  );
};

/* -------- tiny Markdown renderer (bold + basic spacing) -------- */
function renderMarkdown(md: string): React.ReactNode {
  const segments = md.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {segments.map((seg, i) => {
        const m = seg.match(/^\*\*([^*]+)\*\*$/);
        if (m) return <strong key={i}>{m[1]}</strong>;
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

/* -------------------- Icons -------------------- */

const MicIcon = ({ className = '' }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
    <path fill="currentColor" d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 14 0h-2z" />
    <path d="M12 17v4m-4 0h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const SendIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M4.5 12L3 4.5 21 12 3 19.5 4.5 12zm0 0L12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PenIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
      fill="currentColor"
    />
  </svg>
);

/* -------------------- Main component -------------------- */

export default function Chat() {
  // Conversation state
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
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll to bottom on updates
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [messages, isStreaming]);

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
    if (draft === false && !text) return;
    if (isStreaming) return;

    const nextMessages: Msg[] = text ? [...messages, { role: 'user', content: text }] : [...messages];

    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);

    const holderIndex = nextMessages.length;
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    let res: Response | null = null;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, draft })
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
        updated[holderIndex] = {
          role: 'assistant',
          content: `[Error ${res.status}] ${errText || 'Problem generating a response.'}`
        };
        return updated;
      });
      setIsStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';

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

    const parsed = extractLetterBlocks(acc);
    if (parsed.english || parsed.englishMD || parsed.translation || parsed.translationMD) {
      setMessages((prev) => {
        const before = parsed.before ? [{ role: 'assistant', content: parsed.before } as Msg] : [];
        const englishCard =
          parsed.english || parsed.englishMD
            ? [
                {
                  role: 'assistant',
                  content: parsed.english || '',
                  meta: { letter: 'en', md: parsed.englishMD || '' }
                } as Msg
              ]
            : [];
        const translationCard =
          parsed.translation || parsed.translationMD
            ? [
                {
                  role: 'assistant',
                  content: parsed.translation || '',
                  meta: { letter: 'translation', md: parsed.translationMD || '', langLabel: parsed.translationLang || undefined }
                } as Msg
              ]
            : [];
        const after = parsed.after ? [{ role: 'assistant', content: parsed.after } as Msg] : [];

        const updated = [...prev];
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
    <div className="flex items-center gap-1 text-blue-500">
      <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '120ms' }} />
      <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '240ms' }} />
    </div>
  );

  /* --------------------------- UI --------------------------- */

  const LetterBubble: React.FC<{ title: string; text: string; md?: string }> = ({ title, text, md }) => (
    <div className="mb-3 sm:mb-4 flex justify-start">
      <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl overflow-hidden border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 bg-sky-50/70 px-3 py-2">
          <div className="text-sm font-medium text-slate-900">{title}</div>
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
        <div className="px-4 py-3">
          {md && md.trim() !== '' ? (
            <div className="whitespace-pre-wrap leading-relaxed text-[0.95rem] text-slate-900">
              {renderMarkdown(md)}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap leading-relaxed text-[0.95rem] text-slate-900">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-sky-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur border-b border-slate-200/70 shadow-[0_1px_24px_-12px_rgba(2,6,23,0.2)]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 shadow-sm" />
            <span className="absolute -right-0 -bottom-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" title="Online" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base md:text-lg font-semibold text-slate-900 leading-tight">Complaint Letter Helper</h1>
            <p className="text-[11px] md:text-xs text-slate-600">
              Chat freely. Click <span className="font-medium text-slate-800">“Write the letter”</span> for a polished draft.
            </p>
          </div>
        </div>
      </header>

      {/* Chat panel */}
      <main className="max-w-3xl mx-auto px-2 sm:px-4">
        <div className="mt-4 sm:mt-6 mb-32 rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur shadow-[0_20px_60px_-20px_rgba(2,6,23,0.25)]">
          {/* Messages */}
          <div ref={scrollerRef} className="h-[64vh] sm:h-[70vh] overflow-y-auto p-3 sm:p-4">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-center text-sm text-slate-600 px-6">
                Tell me what happened, or tap the mic to speak. Include dates, who you spoke to, and what outcome you want.
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              const isLetterEn = m.meta?.letter === 'en';
              const isLetterTr = m.meta?.letter === 'translation';

              if (isLetterEn) return <LetterBubble key={i} title="Letter (English)" text={m.content} md={m.meta?.md} />;

              if (isLetterTr) {
                const lang = m.meta?.langLabel ? ` – ${m.meta.langLabel}` : '';
                return <LetterBubble key={i} title={`Letter (Translation${lang})`} text={m.content} md={m.meta?.md} />;
              }

              return (
                <div key={i} className={`mb-3 sm:mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={[
                      'max-w-[85%] sm:max-w-[75%] px-3 py-2 sm:px-4 sm:py-3 rounded-2xl text-[0.95rem] leading-relaxed whitespace-pre-wrap shadow-sm',
                      isUser
                        ? 'bg-gradient-to-br from-sky-100 to-indigo-100 text-slate-900 rounded-br-sm border border-sky-200/60'
                        : 'bg-slate-50 text-slate-900 rounded-bl-sm border border-slate-200/70'
                    ].join(' ')}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}

            {isStreaming && (
              <div className="mb-3 sm:mb-4 flex justify-start">
                <div className="bg-slate-50 text-slate-900 rounded-2xl rounded-bl-sm px-3 py-2 sm:px-4 sm:py-3 border border-slate-200/70">
                  <TypingDots />
                </div>
              </div>
            )}

            {isTranscribing && !isStreaming && (
              <div className="mb-3 sm:mb-4 flex justify-start">
                <div className="bg-slate-50 text-slate-900 rounded-2xl rounded-bl-sm px-3 py-2 sm:px-4 sm:py-3 border border-slate-200/70">
                  <span className="text-slate-500">Transcribing…</span>
                </div>
              </div>
            )}
          </div>

          {/* Composer — Aria‑style segmented controls */}
          <div className="sticky bottom-0 border-t border-slate-200/70 bg-white/85 backdrop-blur rounded-b-2xl">
            <div className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3">
              {/* Mic */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                aria-pressed={isRecording}
                title={isRecording ? 'Stop recording' : 'Start recording'}
                className={[
                  'relative rounded-full w-11 h-11 sm:w-12 sm:h-12 border transition shadow-sm',
                  isRecording
                    ? 'bg-blue-600 border-blue-600 text-white shadow-[0_0_0_4px_rgba(37,99,235,0.15)] animate-pulse'
                    : 'bg-white border-slate-200 text-blue-700 hover:bg-slate-50'
                ].join(' ')}
              >
                <MicIcon className="w-5 h-5 mx-auto" />
                {isRecording && <span className="pointer-events-none absolute inset-0 rounded-full ring-8 ring-blue-300/30" />}
              </button>

              {/* Input */}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Write here…"
                className="flex-1 border border-slate-200 bg-white rounded-xl px-3 sm:px-4 py-2 sm:py-3 outline-none focus:ring-2 focus:ring-sky-300 shadow-sm"
              />

              {/* Segmented actions */}
              <div
                className={[
                  'inline-flex items-stretch rounded-full border shadow-sm overflow-hidden',
                  'border-slate-200 bg-white'
                ].join(' ')}
                role="group"
                aria-label="Composer actions"
              >
                {/* Send (primary) */}
                <button
                  onClick={send}
                  disabled={isStreaming || input.trim().length === 0}
                  className={[
                    'flex items-center gap-2 pl-3 pr-3 sm:pl-4 sm:pr-4 py-2 sm:py-3 text-sm font-medium',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-sky-300',
                    'transition',
                    isStreaming || input.trim().length === 0
                      ? 'bg-sky-200 text-white cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 active:from-blue-800 active:to-indigo-800'
                  ].join(' ')}
                  title="Send message"
                >
                  <SendIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Send</span>
                </button>

                {/* Divider */}
                <div className="w-px bg-slate-200/80 self-stretch" aria-hidden="true" />

                {/* Write the letter (ghost/outline) */}
                <button
                  onClick={writeLetter}
                  disabled={isStreaming}
                  className={[
                    'flex items-center gap-2 pl-3 pr-3 sm:pl-4 sm:pr-4 py-2 sm:py-3 text-sm font-medium',
                    'text-sky-800 hover:bg-sky-50 active:bg-sky-100',
                    'disabled:opacity-60 disabled:cursor-not-allowed',
                    'transition'
                  ].join(' ')}
                  title="Draft the final letter (English with translation)"
                >
                  <PenIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Write the letter</span>
                </button>
              </div>
            </div>
          </div>
          {/* /Composer */}
        </div>
      </main>
    </div>
  );
}