'use client';

import React, { useEffect, useRef, useState } from 'react';

// Add this declaration for speech recognition
declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }
}

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  meta?: { letter?: 'en' | 'translation'; md?: string; langLabel?: string };
};

// Fix the AnySR type
type AnySR = SpeechRecognition | null;

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
  copyFormatted?: boolean;
  sourceElementId?: string;
}> = ({ text, label = 'Copy', className, variant = 'secondary', copyFormatted = false, sourceElementId }) => {
  const [done, setDone] = useState(false);
  const base =
    variant === 'primary'
      ? 'bg-gradient-to-r from-sky-400 to-sky-500 text-white hover:from-sky-500 hover:to-sky-600 border-0 shadow-lg'
      : 'border border-gray-200/60 bg-white/80 text-gray-700 hover:bg-gray-50/80 backdrop-blur-sm';
  
  const handleCopy = async () => {
    try {
      if (copyFormatted && sourceElementId) {
        const sourceElement = document.getElementById(sourceElementId);
        if (sourceElement) {
          const range = document.createRange();
          range.selectNodeContents(sourceElement);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('copy');
            selection.removeAllRanges();
            setDone(true);
            setTimeout(() => setDone(false), 1500);
            return;
          }
        }
      }
      
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch (error) {
      try {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      } catch {}
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={[
        'rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-200 active:scale-95 shadow-sm',
        base,
        className || ''
      ].join(' ')}
      aria-label="Copy to clipboard"
    >
      {done ? '✓ Copied' : label}
    </button>
  );
};

/* -------- Markdown renderer -------- */
function renderMarkdown(md: string): React.ReactNode {
  const segments = md.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {segments.map((seg, i) => {
        const m = seg.match(/^\*\*([^*]+)\*\*$/);
        if (m) return <strong key={i} className="font-semibold text-gray-900">{m[1]}</strong>;
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

/* -------------------- Icons -------------------- */

const MicIcon = ({ className = '' }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v1a7 7 0 1 1-14 0v-1a1 1 0 0 1 2 0v1a5 5 0 1 0 10 0v-1a1 1 0 1 1 2 0Z" />
    <path d="M12 18.5a1 1 0 0 1 1 1V22a1 1 0 1 1-2 0v-2.5a1 1 0 0 1 1-1Z" />
  </svg>
);

const SendIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

const PenIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </svg>
);

const SparkleIcon = ({ className = '' }: { className?: string }) => (
  <span className={className} role="img" aria-label="envelope">
    ✉️
  </span>
);

const DocumentIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Focus and reset height when input is cleared
    if (inputRef.current) {
      inputRef.current.focus();
      if (!input) {
        inputRef.current.style.height = 'auto';
      }
    }
  }, [input]);

  // Initial focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll to bottom on updates
  useEffect(() => {
    if (!scrollerRef.current) return;
    const scroller = scrollerRef.current;
    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: 'smooth'
      });
    });
  }, [messages, isStreaming]);

  // Speech recognition setup
  useEffect(() => {
    const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
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
    try {
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
        } catch (error) {
          console.error('Transcription failed:', error);
        }
        setIsTranscribing(false);
        setIsRecording(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
    } catch (error) {
      console.error('Recording failed:', error);
    }
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

  const send = async () => {
    await sendWithPhase(false);
  };

  const writeLetter = async () => {
    await sendWithPhase(true);
  };

  const sendWithPhase = async (draft: boolean) => {
    const text = input.trim();
    if (draft === false && !text) return;
    if (isStreaming) return;

    const nextMessages: Msg[] = text ? [...messages, { role: 'user', content: text }] : [...messages];

    setMessages(nextMessages);
    setInput('');
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    
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
    } catch (e: unknown) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[holderIndex] = { role: 'assistant', content: `Network error: ${String(e && typeof e === 'object' && 'message' in e ? e.message : e)}` };
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
          content: `Error ${res.status}: ${errText || 'Problem generating response'}`
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Auto-resize textarea like WhatsApp
  const adjustTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 96; // ~4 lines max
    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    textarea.style.overflowY = scrollHeight > maxHeight ? 'scroll' : 'hidden';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    adjustTextareaHeight(e.target);
  };

  const TypingDots = () => (
    <div className="flex items-center gap-2">
      <div className="flex space-x-1">
        <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="ml-1 text-sm text-gray-500">AI is thinking</span>
    </div>
  );

  /* --------------------------- UI --------------------------- */

  const LetterBubble: React.FC<{ title: string; text: string; md?: string; index: number }> = ({ title, text, md, index }) => {
    const contentId = `letter-content-${index}`;
    
    return (
      <div className="mb-6 flex justify-start">
        <div className="max-w-[90%] rounded-3xl overflow-hidden border-2 border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-yellow-50/80 to-orange-50/70 backdrop-blur-md shadow-2xl ring-1 ring-amber-100/60">
          <div className="flex items-center justify-between gap-3 border-b-2 border-amber-200/70 bg-gradient-to-r from-amber-100/60 via-yellow-100/50 to-amber-100/60 px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 via-yellow-600 to-orange-600 flex items-center justify-center shadow-lg">
                <SparkleIcon className="w-4 h-4 text-white drop-shadow-sm" />
              </div>
              <span className="text-base font-bold text-amber-900 truncate">{title}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <CopyButton 
                text={text || md || ''} 
                label="Copy Rich" 
                variant="primary" 
                copyFormatted={true}
                sourceElementId={contentId}
              />
              <CopyButton 
                text={text || md || ''} 
                label="Copy Plain" 
                variant="secondary" 
              />
            </div>
          </div>
          <div className="px-6 py-5 bg-gradient-to-b from-yellow-50/80 to-amber-50/60">
            <div id={contentId} className="whitespace-pre-wrap leading-relaxed text-gray-900 font-medium">
              {md && md.trim() !== '' ? (
                renderMarkdown(md)
              ) : (
                text
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-sky-100/50">
      {/* Header - Polished style with gentle sky gradients */}
      <header className="flex items-center gap-4 p-4 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-sm">
        <div className="relative">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-sky-300 via-sky-400 to-sky-500 shadow-lg flex items-center justify-center">
            <SparkleIcon className="w-5 h-5 text-white" />
          </div>
          <div className="absolute -right-1 -bottom-1 h-4 w-4 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 ring-2 ring-white shadow-sm" title="Online" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-sky-700 bg-clip-text text-transparent">
            Complaint Letter Assistant
          </h1>
          <p className="text-xs text-gray-600">
            AI-powered help for social housing complaints • 
            <span className="font-medium text-sky-600 ml-1">Draft letters in seconds</span>
          </p>
        </div>
      </header>

      {/* Messages area - WhatsApp style */}
      <div 
        ref={scrollerRef} 
        className="flex-1 overflow-y-auto p-4 space-y-2"
        style={{ minHeight: 0 }}
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-50 to-sky-100 flex items-center justify-center mx-auto mb-4">
                <SparkleIcon className="w-8 h-8 text-sky-500" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Start Your Complaint</h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                Describe your housing issue, or use the mic to speak. Include dates, who you contacted, and what resolution you're seeking.
              </p>
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const isLetterEn = m.meta?.letter === 'en';
          const isLetterTr = m.meta?.letter === 'translation';

          if (isLetterEn) return <LetterBubble key={i} index={i} title="📝 Your Letter (English)" text={m.content} md={m.meta?.md} />;

          if (isLetterTr) {
            const lang = m.meta?.langLabel ? ` — ${m.meta.langLabel}` : '';
            return <LetterBubble key={i} index={i} title={`🌐 Translation${lang}`} text={m.content} md={m.meta?.md} />;
          }

          return (
            <div key={i} className={`flex mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-lg backdrop-blur-sm',
                  isUser
                    ? 'bg-gradient-to-r from-sky-300 to-sky-400 text-white rounded-br-md'
                    : 'bg-white/80 text-gray-800 rounded-bl-md border border-gray-200/50'
                ].join(' ')}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          );
        })}

        {isStreaming && (
          <div className="mb-4 flex justify-start">
            <div className="bg-white/80 text-gray-800 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-200/50 shadow-lg backdrop-blur-sm">
              <TypingDots />
            </div>
          </div>
        )}

        {isTranscribing && !isStreaming && (
          <div className="mb-4 flex justify-start">
            <div className="bg-white/80 text-gray-800 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-200/50 shadow-lg backdrop-blur-sm">
              <span className="text-sky-600">🎙️ Transcribing audio...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input area - Polished WhatsApp-style with optimized padding */}
      <div className="bg-white/80 backdrop-blur-xl border-t border-gray-200/50 shadow-2xl p-3 safe-area-inset-bottom">
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-gray-200/50 shadow-2xl p-2">
          <div className="flex items-center gap-2">
            {/* Draft letter button - now on the left */}
            <button
              onClick={writeLetter}
              disabled={isStreaming}
              className={[
                'h-11 transition-all duration-200 shadow-lg flex-shrink-0 flex items-center justify-center',
                'bg-gradient-to-r from-sky-300 via-sky-400 to-sky-500 text-white',
                'hover:from-sky-400 hover:via-sky-500 hover:to-sky-600',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                // Mobile: just pen icon (circular)
                'w-11 rounded-2xl sm:w-auto sm:px-5 sm:gap-2 sm:rounded-2xl'
              ].join(' ')}
              title="Generate a formal complaint letter"
            >
              <PenIcon className="w-4 h-4" />
              <span className="hidden sm:inline font-medium text-sm">Draft Letter</span>
            </button>

            {/* Input field */}
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={onKeyDown}
                placeholder="Describe your housing issue..."
                rows={1}
                className="w-full border border-gray-200/70 bg-white/70 rounded-2xl px-4 text-sm outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300 transition-all duration-200 backdrop-blur-sm resize-none leading-5 h-11 max-h-24 flex items-center"
                style={{ 
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 transparent',
                  paddingTop: '10px',
                  paddingBottom: '10px'
                }}
              />
            </div>

            {/* Context-sensitive button - Mic when empty, Send when typing (WhatsApp style) */}
            {input.trim() ? (
              <button
                onClick={send}
                disabled={isStreaming}
                className="w-11 h-11 rounded-2xl bg-gradient-to-r from-sky-300 to-sky-400 text-white flex items-center justify-center transition-all duration-200 hover:shadow-lg disabled:opacity-50 flex-shrink-0"
                title="Send message"
              >
                <SendIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                className={[
                  'relative w-11 h-11 rounded-2xl border transition-all duration-200 shadow-lg flex-shrink-0',
                  isRecording
                    ? 'bg-gradient-to-r from-red-500 to-pink-600 border-red-500 text-white shadow-red-200 scale-110'
                    : 'bg-white border-gray-200 text-sky-600 hover:bg-sky-50 hover:border-sky-200'
                ].join(' ')}
                title={isRecording ? 'Stop recording' : 'Start recording'}
              >
                <MicIcon className="w-4 h-4 mx-auto" />
                {isRecording && (
                  <div className="absolute inset-0 rounded-2xl bg-red-400/20 animate-pulse" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}