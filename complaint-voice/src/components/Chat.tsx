'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

// Add this declaration for speech recognition
declare global {
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  meta?: { letter?: 'en' | 'translation'; md?: string; langLabel?: string };
};

// Fix the AnySR type
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
    } catch {
      // ignore
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

/* -------- Improved Markdown renderer (bold + italics + simple lists/headings) -------- */

const renderInline = (s: string, keyBase: string) => {
  const boldParts = s.split(/(\*\*[^*]+\*\*)/g);

  return boldParts.map((bp, bi) => {
    const boldMatch = bp.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return (
        <strong key={`${keyBase}-b-${bi}`} className="font-semibold text-gray-900">
          {boldMatch[1]}
        </strong>
      );
    }

    const italicParts = bp.split(/(\*[^*]+\*|_[^_]+_)/g);
    return italicParts.map((ip, ii) => {
      const iMatch = ip.match(/^\*(.+)\*$/) || ip.match(/^_(.+)_$/);
      if (iMatch) {
        return (
          <em key={`${keyBase}-i-${bi}-${ii}`} className="italic text-gray-800">
            {iMatch[1]}
          </em>
        );
      }
      const withBreaks = ip.split(/ {2,}\n|\\n/g);
      return withBreaks.map((chunk, ci) =>
        ci < withBreaks.length - 1 ? (
          <React.Fragment key={`${keyBase}-t-${bi}-${ii}-${ci}`}>
            {chunk}
            <br />
          </React.Fragment>
        ) : (
          <span key={`${keyBase}-t-${bi}-${ii}-${ci}`}>{chunk}</span>
        )
      );
    });
  });
};

const renderList = (
  items: { text: string }[],
  ordered: boolean,
  blockKey: string
) => {
  if (ordered) {
    return (
      <ol key={blockKey} className="list-decimal ml-6 my-2 space-y-1 text-gray-900">
        {items.map((it, i) => (
          <li key={`${blockKey}-li-${i}`} className="pl-1">
            {renderInline(it.text, `${blockKey}-li-${i}`)}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul key={blockKey} className="list-disc ml-6 my-2 space-y-1 text-gray-900">
      {items.map((it, i) => (
        <li key={`${blockKey}-li-${i}`} className="pl-1">
          {renderInline(it.text, `${blockKey}-li-${i}`)}
        </li>
      ))}
    </ul>
  );
};

const renderHeader = (text: string, level: number, key: string) => {
  const sizes: Record<number, string> = {
    1: 'text-xl',
    2: 'text-lg',
    3: 'text-base',
  };
  const cls = `${sizes[level] || 'text-base'} font-bold text-gray-900 mt-3 mb-1`;
  const tagName = `h${Math.min(3, Math.max(1, level))}`;
  if (tagName === 'h1') return <h1 key={key} className={cls}>{renderInline(text, key)}</h1>;
  if (tagName === 'h2') return <h2 key={key} className={cls}>{renderInline(text, key)}</h2>;
  return <h3 key={key} className={cls}>{renderInline(text, key)}</h3>;
};

const renderParagraph = (text: string, key: string) => (
  <p key={key} className="my-2 leading-relaxed text-gray-900">
    {renderInline(text, key)}
  </p>
);

function renderMarkdown(md: string): React.ReactNode {
  if (!md) return null;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i += 1; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { out.push(renderHeader(h[2].trim(), h[1].length, `h-${i}`)); i += 1; continue; }
    if (/^[-_]{3,}\s*$/.test(line)) { out.push(<hr key={`hr-${i}`} className="my-3 border-amber-200/70" />); i += 1; continue; }
    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      const items: { text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.+)$/);
        if (!m) break;
        items.push({ text: m[1] });
        i += 1;
      }
      out.push(renderList(items, false, `ul-${i}-${items.length}`));
      continue;
    }
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      const items: { text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.+)$/);
        if (!m) break;
        items.push({ text: m[1] });
        i += 1;
      }
      out.push(renderList(items, true, `ol-${i}-${items.length}`));
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^[-_]{3,}\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(renderParagraph(para.join('\n'), `p-${i}`));
  }
  return <>{out}</>;
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
  const [isTranscribing, setIsTranscribing] = useState(false); // fallback only

  // Streaming UI state
  const [isStreaming, setIsStreaming] = useState(false);

  // NEW: sending guard and voice session tracking
  const [isSending, setIsSending] = useState(false);
  const voiceSessionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll state
  const [headerBlur, setHeaderBlur] = useState(false);

  // Device detection
  const [isAndroid, setIsAndroid] = useState(false);
  const [isMobile, setIsMobile] = useState(false); // phones or small screens

  // Refs
  const recognitionRef = useRef<AnySR | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null); // fallback
  const chunksRef = useRef<BlobPart[]>([]); // fallback
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Continuous SR buffers and UI throttle
  const committedTextRef = useRef('');           // finalised transcript (stable)
  const interimTextRef = useRef('');             // latest interim words for overlay/commit-on-stop
  const rafUpdateRef = useRef<number | null>(null);

  // Dedup guards for Android
  const seenFinalsRef = useRef<Set<string>>(new Set());

  // UI for listening status and speed
  const [listeningBadge, setListeningBadge] = useState<'idle' | 'starting' | 'listening'>('idle');
  const [micReady, setMicReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const interimKickRef = useRef<number | null>(null);

  // Optional live overlay toggle
  const [liveMode] = useState(true);

  // Tiny “speaking” pulse on the mic
  const [audioActive, setAudioActive] = useState(false);

  // Last-word protection
  const settleTimerRef = useRef<number | null>(null);
  const promoteInterimToFinal = () => {
    const tail = (interimTextRef.current || '').trim();
    if (!tail) return;
    committedTextRef.current = normalise(committedTextRef.current + ' ' + tail);
    interimTextRef.current = '';
    setInput(committedTextRef.current);
  };

  // Normaliser
  const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

  // Android-safe append that avoids loops/duplicates
  const appendFinalChunk = (raw: string) => {
    const chunk = normalise(raw);
    if (!chunk) return;

    // Skip exact repeats
    if (seenFinalsRef.current.has(chunk)) return;

    const current = committedTextRef.current;
    if (!current) {
      committedTextRef.current = chunk;
      setInput(committedTextRef.current);
      seenFinalsRef.current.add(chunk);
      return;
    }

    // If engine re-sends a previous sentence, ignore it
    if (current.endsWith(chunk) || current.includes(' ' + chunk + ' ')) {
      seenFinalsRef.current.add(chunk);
      return;
    }

    // Overlap guard: if chunk begins with the tail of current, only add the non-overlapping part
    const tailLen = Math.min(80, current.length);
    const tail = current.slice(-tailLen);
    if (chunk.startsWith(tail)) {
      const addition = normalise(chunk.slice(tail.length));
      if (!addition) { seenFinalsRef.current.add(chunk); return; }
      committedTextRef.current = normalise(current + ' ' + addition);
    } else {
      committedTextRef.current = normalise(current + ' ' + chunk);
    }

    setInput(committedTextRef.current);
    seenFinalsRef.current.add(chunk);
  };

  // Add custom styles for animations
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes float { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-4px);} }
      @keyframes slide-in { from { opacity: 0; transform: translateX(-20px);} to { opacity: 1; transform: translateX(0);} }
      @keyframes pulse-subtle { 0%,100% { transform: scale(1.1);} 50% { transform: scale(1.15);} }
      @keyframes pulse-slow { 0%,100% { opacity: 1;} 50% { opacity: 0.6;} }
      .animate-fade-in { animation: fade-in 0.6s ease-out forwards; }
      .animate-float { animation: float 3s ease-in-out infinite; }
      .animate-slide-in { animation: slide-in 0.4s ease-out forwards; opacity: 0; }
      .animate-pulse-subtle { animation: pulse-subtle 2s ease-in-out infinite; }
      .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }
      .scrollbar-thin { scrollbar-width: thin; }
      .scrollbar-thumb-sky-200 { scrollbar-color: #bae6fd transparent; }
      .scrollbar-track-transparent { scrollbar-track-color: transparent; }
      .scrollbar-thin::-webkit-scrollbar { width: 6px; }
      .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
      .scrollbar-thin::-webkit-scrollbar-thumb { background-color: #bae6fd; border-radius: 3px; transition: background-color 0.2s ease; }
      .scrollbar-thin::-webkit-scrollbar-thumb:hover { background-color: #7dd3fc; }
      .shadow-3xl { box-shadow: 0 35px 60px -12px rgba(0,0,0,0.25); }
      .hover-lift { transition: all 0.3s cubic-bezier(0.4,0,0.2,1); }
      .hover-lift:hover { transform: translateY(-2px); box-shadow: 0 20px 40px rgba(0,0,0,0.15); }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  // Device detection
  useEffect(() => {
    const ua = navigator.userAgent || '';
    setIsAndroid(/Android/i.test(ua));
    const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
    const isSmallScreen = window.innerWidth < 640;
    setIsMobile(isMobileUA || isSmallScreen);

    const onResize = () => {
      setIsMobile(isMobileUA || window.innerWidth < 640);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Improved scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (!scrollerRef.current) return;
    requestAnimationFrame(() => {
      if (scrollerRef.current) {
        scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
      }
    });
  }, []);

  // Dynamic header blur
  const handleScroll = useCallback(() => {
    if (!scrollerRef.current) return;
    const scrolled = scrollerRef.current.scrollTop > 20;
    if (scrolled !== headerBlur) setHeaderBlur(scrolled);
  }, [headerBlur]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (!input) {
        inputRef.current.style.height = 'auto';
      } else {
        adjustTextareaHeight(inputRef.current);
      }
    }
  }, [input]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming, scrollToBottom]);

  // SR instance init only
  useEffect(() => {
    const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-GB';
    rec.continuous = true;     // enable continuous dictation
    rec.interimResults = true; // show partials (but keep them out of the textbox)
    rec.maxAlternatives = 1;
    recognitionRef.current = rec;
  }, []);

  const ensureMicPermission = async () => {
    if (micReady) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicReady(true);
      return true;
    } catch {
      return false;
    }
  };

  // Start continuous recording with overlay and auto-restart
  const startRecording = async () => {
    if (isStarting || isRecording || isSending) return;
    setIsStarting(true);
    setListeningBadge('starting');

    const rec = recognitionRef.current;

    // Fallback if SR not available
    if (!rec) {
      try {
        const ok = await ensureMicPermission();
        if (!ok) { setIsStarting(false); setListeningBadge('idle'); return; }
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
            if (data?.text) {
              committedTextRef.current = normalise(input.trim() + ' ' + data.text);
              setInput(committedTextRef.current);
            }
          } catch {}
          setIsTranscribing(false);
          setIsRecording(false);
          setListeningBadge('idle');
          stream.getTracks().forEach(t => t.stop());
        };
        mr.start();
        mediaRecorderRef.current = mr;
        setIsRecording(true);
        setIsStarting(false);
        setListeningBadge('listening');
      } catch {
        setIsStarting(false);
        setListeningBadge('idle');
      }
      return;
    }

    const ok = await ensureMicPermission();
    if (!ok) { setIsStarting(false); setListeningBadge('idle'); return; }

    // Fresh handlers for this run
    rec.onstart = () => {
      setIsRecording(true);
      setIsStarting(false);
      setListeningBadge('listening');

      // Reset buffers on actual start to capture first words
      committedTextRef.current = input.trim();
      interimTextRef.current = '';
      seenFinalsRef.current.clear(); // reset dedupe on fresh start

      // kick hint if no interim quickly
      if (interimKickRef.current) window.clearTimeout(interimKickRef.current);
      interimKickRef.current = window.setTimeout(() => {}, 400);
    };

    rec.onaudiostart = () => setAudioActive(true);
    rec.onaudioend = () => setAudioActive(false);

    // Settle quicker when silence detected
    rec.onspeechend = () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        if (isRecording) promoteInterimToFinal();
      }, 250);
    };

    rec.onresult = (e: any) => {
      let finalChunk = '';
      let interimChunk = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalChunk += transcript + ' ';
        else interimChunk += transcript + ' ';
      }

      if (finalChunk) {
        // Android sometimes resends old finals on restart — dedupe before append
        appendFinalChunk(finalChunk);
      }

      interimTextRef.current = interimChunk.trim();

      if (interimKickRef.current) {
        window.clearTimeout(interimKickRef.current);
        interimKickRef.current = null;
      }

      // restart the silence settle timer to protect the last word
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        if (isRecording) promoteInterimToFinal();
      }, 450);

      // paint next frame for overlay (keeps overlay snappy)
      if (rafUpdateRef.current) cancelAnimationFrame(rafUpdateRef.current);
      rafUpdateRef.current = requestAnimationFrame(() => {});
    };

    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        setIsRecording(false);
        setIsStarting(false);
        setListeningBadge('idle');
      }
      // Soft errors handled by onend
    };

    rec.onend = () => {
      // Flush any stranded interim so the last word is not lost
      promoteInterimToFinal();
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }

      // Auto-restart while user expects recording
      if (isRecording && !isSending) {
        const delay = isAndroid ? 400 : 120; // gentler restart on Android
        setTimeout(() => {
          try { rec.start(); } catch {}
        }, delay);
      } else {
        setListeningBadge('idle');
      }
    };

    try {
      // Abort any ghost session then start
      try { (rec as any).abort?.(); } catch {}
      rec.start();
    } catch {
      setIsStarting(false);
      setListeningBadge('idle');
    }
  };

  const stopRecording = () => new Promise<void>((resolve) => {
    setIsRecording(false);
    setIsStarting(false);
    voiceSessionRef.current += 1; // Invalidate current session
    setListeningBadge('idle');

    // Give the engine a short grace period to deliver a final result
    const GRACE = 200;
    const finish = () => {
      // Commit any leftover interim so nothing is lost
      promoteInterimToFinal();

      if (recognitionRef.current) {
        const rec: AnySR = recognitionRef.current;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try { rec.stop(); } catch {}
      }
      resolve();
    };

    if (recognitionRef.current) {
      window.setTimeout(finish, GRACE);
      return;
    }

    // Fallback MediaRecorder stop
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.addEventListener('stop', () => resolve(), { once: true });
      mediaRecorderRef.current.stop();
      return;
    }

    resolve();
  });

  const send = async () => {
    if (isRecording) {
      await stopRecording();
    }
    await sendWithPhase(false);
  };

  const writeLetter = async () => {
    if (isRecording) {
      await stopRecording();
    }
    await sendWithPhase(true);
  };

  const sendWithPhase = async (draft: boolean) => {
    const text = input.trim();
    if (draft === false && !text) return;
    if (isStreaming || isSending) return;

    setIsSending(true);

    // Freeze current voice session so late events are ignored
    voiceSessionRef.current += 1;

    const nextMessages: Msg[] = text ? [...messages, { role: 'user', content: text }] : [...messages];

    setMessages(nextMessages);
    setInput('');
    
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsStreaming(true);

    const holderIndex = nextMessages.length;
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    let res: Response | null = null;
    try {
      const controller = new AbortController();
      abortRef.current = controller;

      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, draft }),
        signal: controller.signal
      });
    } catch (e: unknown) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[holderIndex] = { role: 'assistant', content: `Network error: ${String(e && typeof e === 'object' && 'message' in e ? (e as any).message : e)}` };
        return updated;
      });
      setIsStreaming(false);
      setIsSending(false);
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
      setIsSending(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accStr = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      accStr += decoder.decode(value, { stream: true });

      setMessages((prev) => {
        const updated = [...prev];
        if (updated[holderIndex]?.role === 'assistant') {
          updated[holderIndex] = { role: 'assistant', content: accStr };
        }
        return updated;
      });
    }

    const parsed = extractLetterBlocks(accStr);
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
    setIsSending(false);
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
    textarea.scrollTop = textarea.scrollHeight;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    adjustTextareaHeight(e.target);
  };

  const TypingDots = () => {
    const [messageIndex, setMessageIndex] = useState(0);
    const typingMessages = [
      "AI is thinking",
      "Analysing your request",
      "Crafting your response",
      "Almost ready"
    ];

    useEffect(() => {
      const interval = setInterval(() => {
        setMessageIndex(prev => (prev + 1) % typingMessages.length);
      }, 2000);
      return () => clearInterval(interval);
    }, []);

    return (
      <div className="flex items-center gap-2">
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="ml-1 text-sm text-gray-500 transition-all duration-500">
          {typingMessages[messageIndex]}...
        </span>
      </div>
    );
  };

  /* --------------------------- UI --------------------------- */

  const LetterBubble: React.FC<{ title: string; text: string; md?: string; index: number }> = ({ title, text, md, index }) => {
    const contentId = `letter-content-${index}`;
    return (
      <div className="mb-6 flex justify-start">
        <div className="max-w-[90%] rounded-3xl overflow-hidden border-2 border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-yellow-50/80 to-orange-50/70 backdrop-blur-md shadow-2xl ring-1 ring-amber-100/60 hover-lift group">
          <div className="flex items-center justify-between gap-3 border-b-2 border-amber-200/70 bg-gradient-to-r from-amber-100/60 via-yellow-100/50 to-amber-100/60 px-5 py-4 group-hover:from-amber-200/60 group-hover:via-yellow-200/50 group-hover:to-amber-200/60 transition-all duration-300">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 via-yellow-600 to-orange-600 flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300">
                <SparkleIcon className="w-4 h-4 text-white drop-shadow-sm" />
              </div>
              <span className="text-base font-bold text-amber-900 truncate">{title}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <CopyButton text={text || md || ''} label="Copy Rich" variant="primary" copyFormatted={true} sourceElementId={contentId} />
              <CopyButton text={text || md || ''} label="Copy Plain" variant="secondary" />
            </div>
          </div>
          <div className="px-6 py-5 bg-gradient-to-b from-yellow-50/80 to-amber-50/60">
            <div id={contentId} className="whitespace-pre-wrap leading-relaxed text-gray-900 font-medium">
              {md && md.trim() !== '' ? renderMarkdown(md) : text}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const voiceOnly = isMobile; // on phones, hide the textbox and go edge-to-edge

  return (
    <div className="flex flex-col h-screen w-full max-w-full overflow-hidden 
                    bg-gradient-to-br from-gray-100 via-gray-50 to-sky-100/50 
                    rounded-t-3xl shadow-lg"
         style={{ height: '100vh', maxHeight: '100vh' }}>

      {/* Header */}
      <header className={`flex-shrink-0 flex items-center gap-4 px-3 h-14 
                     bg-gradient-to-r from-sky-100 via-sky-200 to-sky-300 
                     border-b border-gray-300 transition-all duration-200 ${headerBlur ? 'shadow-lg' : ''}`}>
        <div className="relative">
          <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-sky-300 via-sky-400 to-sky-500 shadow-lg flex items-center justify-center">
            <SparkleIcon className="w-4 h-4 text-white" />
          </div>
          <div className="absolute -right-1 -bottom-1 h-3 w-3 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 ring-2 ring-white shadow-sm animate-pulse-slow" title="Online" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900 font-sans">
            Complaint Letter Assistant
          </h1>
        </div>
      </header>

      {/* Messages area */}
      <div 
        ref={scrollerRef} 
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto ${voiceOnly ? 'px-0' : 'px-4'} py-0 space-y-2 bg-gradient-to-br from-white via-sky-50 to-sky-100 scrollbar-thin scrollbar-thumb-sky-200 scrollbar-track-transparent`}
        style={{ minHeight: 0, overscrollBehavior: 'contain' }}
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className={`text-center max-w-md mx-auto ${voiceOnly ? 'px-3' : 'px-4'} animate-fade-in`}>
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-300 via-sky-400 to-sky-500 flex items-center justify-center mx-auto mb-4 shadow-lg animate-float">
                <SparkleIcon className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Start Your Complaint</h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                {voiceOnly ? 'Tap the mic and speak. We will capture your words and you can send or draft when ready.' :
                  'Describe your housing issue, or use the mic to speak. Include dates, who you contacted, and what resolution you\'re seeking.'}
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
            <div key={i} className={`flex mb-4 animate-slide-in ${isUser ? 'justify-end' : 'justify-start'}`} style={{ animationDelay: `${i * 100}ms` }}>
              <div
                className={[
                  'max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-lg backdrop-blur-sm transition-all duration-200 hover:shadow-xl',
                  isUser
                    ? 'bg-gradient-to-r from-sky-300 to-sky-400 text-white rounded-br-md hover:from-sky-400 hover:to-sky-500 transform hover:scale-[1.02]'
                    : 'bg-white/80 text-gray-800 rounded-bl-md border border-gray-200/50 hover:bg-white/90 hover:border-gray-300/50 transform hover:scale-[1.02]'
                ].join(' ')}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          );
        })}

        {isStreaming && (
          <div className="mb-4 flex justify-start animate-slide-in">
            <div className="bg-white/90 text-gray-800 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-200/50 shadow-lg backdrop-blur-sm">
              <TypingDots />
            </div>
          </div>
        )}

        {isTranscribing && !isStreaming && (
          <div className="mb-4 flex justify-start animate-slide-in">
            <div className="bg-white/90 text-gray-800 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-200/50 shadow-lg backdrop-blur-sm">
              <span className="text-sky-600 flex items-center gap-2">
                <span className="animate-pulse">🎙️</span> 
                Transcribing audio...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom action area */}
      {voiceOnly ? (
        // Mobile / Android: edge-to-edge, no textarea
        <div className="flex-shrink-0 bg-white border-t border-gray-200 shadow-2xl px-0 pb-[max(env(safe-area-inset-bottom),12px)]">
          {/* Live transcript line (lightweight) */}
          {(isRecording || input.trim()) && (
            <div className="px-4 py-2 text-sm text-gray-700">
              <span className="whitespace-pre-wrap">
                {input}{interimTextRef.current ? (' ' + interimTextRef.current) : ''}
              </span>
            </div>
          )}
          {/* Full-width buttons */}
          <div className="grid grid-cols-3 divide-x divide-gray-200">
            {/* Draft */}
            <button
              onClick={writeLetter}
              disabled={isStreaming || isSending}
              className="h-12 w-full flex items-center justify-center text-sm font-medium bg-gradient-to-r from-sky-300 via-sky-400 to-sky-500 text-white active:scale-95 disabled:opacity-50"
              title="Draft Letter"
            >
              <PenIcon className="w-4 h-4 mr-2" /> Draft
            </button>

            {/* Send */}
            <button
              onClick={send}
              disabled={isStreaming || isSending || !input.trim()}
              className="h-12 w-full flex items-center justify-center text-sm font-medium bg-sky-600 text-white active:scale-95 disabled:bg-gray-200 disabled:text-gray-400"
              title="Send"
            >
              <SendIcon className="w-4 h-4 mr-2" /> Send
            </button>

            {/* Mic */}
            {isRecording ? (
              <button
                type="button"
                onClick={() => { stopRecording(); }}
                disabled={isStreaming || isSending}
                aria-label="Stop recording"
                className="relative h-12 w-full flex items-center justify-center text-sm font-medium bg-gradient-to-r from-red-500 to-pink-600 text-white active:scale-95"
                title="Stop"
              >
                <MicIcon className="w-4 h-4 mr-2" /> Stop
                {audioActive && (
                  <span className="absolute right-2 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={isStreaming || isSending || isStarting}
                aria-label="Start recording"
                className={`h-12 w-full flex items-center justify-center text-sm font-medium ${isStarting ? 'bg-gray-100 text-gray-400' : 'bg-emerald-600 text-white active:scale-95'}`}
                title="Record"
              >
                <MicIcon className="w-4 h-4 mr-2" /> Record
              </button>
            )}
          </div>
        </div>
      ) : (
        // Desktop / larger screens: original textarea + buttons
        <div className="flex-shrink-0 bg-white/80 border-t border-gray-200/50 shadow-2xl px-3 pb-3 safe-area-inset-bottom">
          <div className="bg-white/90 rounded-3xl border border-gray-200/50 shadow-2xl p-2 hover:shadow-3xl transition-all duration-200">
            <div className="flex items-center gap-2">
              {/* Draft letter button */}
              <button
                onClick={writeLetter}
                disabled={isStreaming || isSending}
                className={[
                  'h-11 transition-all duration-200 shadow-lg flex-shrink-0 flex items-center justify-center',
                  'bg-gradient-to-r from-sky-300 via-sky-400 to-sky-500 text-white',
                  'hover:from-sky-400 hover:via-sky-500 hover:to-sky-600',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2',
                  'active:scale-95 hover:scale-105 hover:shadow-xl',
                  'w-11 rounded-2xl sm:w-auto sm:px-5 sm:gap-2 sm:rounded-2xl'
                ].join(' ')}
                title="Generate a formal complaint letter"
              >
                <PenIcon className="w-4 h-4 transition-transform duration-200 group-hover:rotate-12" />
                <span className="hidden sm:inline font-medium text-sm">Draft Letter</span>
              </button>

              {/* Input field wrapper with live overlay */}
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={onKeyDown}
                  placeholder={listeningBadge === 'listening' ? 'Listening… speak clearly' : 'Describe your housing issue...'}
                  rows={1}
                  className="w-full border border-gray-200/70 bg-white/80 rounded-2xl px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400 transition-all duration-200 backdrop-blur-sm resize-none leading-5 h-11 max-h-24 flex items-center hover:bg-white/90 hover:border-gray-300/70"
                  style={{ 
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#cbd5e0 transparent',
                    paddingTop: '10px',
                    paddingBottom: '10px'
                  }}
                />

                {/* Live overlay shows interim words instantly without shifting layout */}
                {liveMode && isRecording && interimTextRef.current && (
                  <div
                    className="pointer-events-none absolute inset-0 rounded-2xl px-4 py-2 text-sm leading-5 flex items-center"
                    aria-hidden="true"
                  >
                    <span className="opacity-0 whitespace-pre-wrap">
                      {input}{input ? ' ' : ''}
                    </span>
                    <span className="absolute left-4 right-4 top-1/2 -translate-y-1/2 text-gray-500/80 italic truncate">
                      {interimTextRef.current}
                    </span>
                  </div>
                )}

                {listeningBadge !== 'idle' && (
                  <div className="absolute -top-6 left-2 text-xs text-sky-600">
                    {listeningBadge === 'starting' ? 'Starting mic…' : 'Listening…'}
                  </div>
                )}
                {input.length > 100 && (
                  <div className="absolute -top-6 right-2 text-xs text-gray-400 animate-fade-in">
                    {input.length}/1000
                  </div>
                )}
              </div>

              {/* Mic / Send button with tiny audio pulse */}
              {isRecording ? (
                <button
                  type="button"
                  onClick={() => { stopRecording(); }}
                  disabled={isStreaming || isSending}
                  aria-label="Stop recording"
                  className="relative w-11 h-11 rounded-2xl border transition-all duration-200 shadow-lg flex-shrink-0
                             bg-gradient-to-r from-red-500 to-pink-600 border-red-500 text-white hover:shadow-xl scale-110 animate-pulse-subtle
                             focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
                  title="Stop recording"
                >
                  <MicIcon className="w-4 h-4 mx-auto" />
                  <div className="absolute inset-0 rounded-2xl bg-red-400/30 animate-ping" />
                  {audioActive && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                </button>
              ) : input.trim() ? (
                <button
                  onClick={send}
                  disabled={isStreaming || isSending}
                  className="w-11 h-11 rounded-2xl bg-gradient-to-r from-sky-300 to-sky-400 text-white flex items-center justify-center transition-all duration-200 hover:shadow-xl disabled:opacity-50 flex-shrink-0 hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2"
                  title="Send message"
                >
                  <SendIcon className="w-4 h-4 transition-transform duration-200 hover:translate-x-0.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={isStreaming || isSending || isStarting}
                  aria-label="Start recording"
                  className={`relative w-11 h-11 rounded-2xl border transition-all duration-200 shadow-lg flex-shrink-0
                             ${isStarting ? 'bg-gray-100 border-gray-200 text-gray-400' : 'bg-white border-gray-200 text-sky-600 hover:bg-sky-50 hover:border-sky-200 hover:scale-105 active:scale-95'}
                             focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2`}
                  title="Start recording"
                >
                  <MicIcon className="w-4 h-4 mx-auto transition-transform duration-200" />
                </button>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
