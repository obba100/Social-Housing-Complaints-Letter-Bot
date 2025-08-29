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

type AnySR = any;

/* ---------------- Letter parsing & Copy helpers ---------------- */

const extractLetterBlocks = (text: string) => {
  const enMatch = text.match(/<<LETTER_EN>>([\s\S]*?)<<\/LETTER_EN>>/);
  const trMatch = text.match(/<<LETTER_TRANSLATION(?:[^>]*)>>([\s\S]*?)<<\/LETTER_TRANSLATION>>/);

  const enMDMatch = text.match(/<<LETTER_EN_MD>>([\s\S]*?)<<\/LETTER_EN_MD>>/);
  const trMDMatch = text.match(
    /<<LETTER_TRANSLATION_MD(?:\s+lang="([^"]+)")?\s*>>([\s\S]*?)<<\/LETTER_TRANSLATION_MD>>/
  );

  let translationLang = '';
  const trLangFromPlain = text.match(/<<LETTER_TRANSLATION\s+lang="([^"]+)"\s*>>/);
  const trLangFromMD = text.match(/<<LETTER_TRANSLATION_MD\s+lang="([^"]+)"\s*>>/);
  if (trLangFromMD?.[1]) translationLang = trLangFromMD[1];
  else if (trLangFromPlain?.[1]) translationLang = trLangFromPlain[1];
  else if (trMDMatch?.[1]) translationLang = trMDMatch[1];

  const before = enMatch ? text.slice(0, enMatch.index).trim() : '';

  const closePositions = [
    enMatch ? enMatch.index! + enMatch[0].length : -1,
    trMatch ? trMatch.index! + trMatch[0].length : -1,
    enMDMatch ? enMDMatch.index! + enMDMatch[0].length : -1,
    trMDMatch ? trMDMatch.index! + trMDMatch[0].length : -1
  ].filter((n) => n >= 0);

  let after = '';
  if (closePositions.length === 0) after = !enMatch ? text.trim() : '';
  else after = text.slice(Math.max(...closePositions)).trim();

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
        const el = document.getElementById(sourceElementId);
        if (el) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('copy');
            sel.removeAllRanges();
            setDone(true);
            setTimeout(() => setDone(false), 1500);
            return;
          }
        }
      }
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {}
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

/* -------- Minimal Markdown renderer -------- */

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

const renderList = (items: { text: string }[], ordered: boolean, blockKey: string) =>
  ordered ? (
    <ol key={blockKey} className="list-decimal ml-6 my-2 space-y-1 text-gray-900">
      {items.map((it, i) => (
        <li key={`${blockKey}-li-${i}`} className="pl-1">
          {renderInline(it.text, `${blockKey}-li-${i}`)}
        </li>
      ))}
    </ol>
  ) : (
    <ul key={blockKey} className="list-disc ml-6 my-2 space-y-1 text-gray-900">
      {items.map((it, i) => (
        <li key={`${blockKey}-li-${i}`} className="pl-1">
          {renderInline(it.text, `${blockKey}-li-${i}`)}
        </li>
      ))}
    </ul>
  );

const renderHeader = (text: string, level: number, key: string) => {
  const sizes: Record<number, string> = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base' };
  const cls = `${sizes[level] || 'text-base'} font-bold text-gray-900 mt-3 mb-1`;
  const tag = `h${Math.min(3, Math.max(1, level))}` as 'h1' | 'h2' | 'h3';
  if (tag === 'h1') return <h1 key={key} className={cls}>{renderInline(text, key)}</h1>;
  if (tag === 'h2') return <h2 key={key} className={cls}>{renderInline(text, key)}</h2>;
  return <h3 key={key} className={cls}>{renderInline(text, key)}</h3>;
};

function renderMarkdown(md: string): React.ReactNode {
  if (!md) return null;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { out.push(renderHeader(h[2].trim(), h[1].length, `h-${i}`)); i++; continue; }
    if (/^[-_]{3,}\s*$/.test(line)) { out.push(<hr key={`hr-${i}`} className="my-3 border-amber-200/70" />); i++; continue; }
    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    if (ul) {
      const items: { text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.+)$/);
        if (!m) break;
        items.push({ text: m[1] }); i++;
      }
      out.push(renderList(items, false, `ul-${i}-${items.length}`)); continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) {
      const items: { text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.+)$/);
        if (!m) break;
        items.push({ text: m[1] }); i++;
      }
      out.push(renderList(items, true, `ol-${i}-${items.length}`)); continue;
    }
    const para: string[] = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,3})\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^[-_]{3,}\s*$/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(<p key={`p-${i}`} className="my-2 leading-relaxed text-gray-900">{renderInline(para.join('\n'), `p-${i}`)}</p>);
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
  <span className={className} role="img" aria-label="envelope">✉️</span>
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

  // NEW: sending guard
  const [isSending, setIsSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll state
  const [headerBlur, setHeaderBlur] = useState(false);

  // Device detection
  const [isMobile, setIsMobile] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  // Refs
  const recognitionRef = useRef<AnySR | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Dictation buffers (token-based)
  const committedTokensRef = useRef<string[]>([]);
  const interimTextRef = useRef(''); // string to overlay
  const seenShinglesRef = useRef<Set<string>>(new Set()); // 3-gram fingerprints
  const processedCursorRef = useRef<number>(0); // per-session result cursor

  // Mic + restart state
  const [listeningBadge, setListeningBadge] = useState<'idle' | 'starting' | 'listening'>('idle');
  const [micReady, setMicReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const wantRecordingRef = useRef(false); // keeps intent across restarts
  const restartCountRef = useRef(0);
  const lastFinalAtRef = useRef<number>(0);
  const recStartAtRef = useRef<number>(0);

  // Tiny pulse
  const [audioActive, setAudioActive] = useState(false);

  // Timers
  const settleTimerRef = useRef<number | null>(null);

  // Helpers
  const normalise = (s: string) => `${s}`.replace(/\s+/g, ' ').trim();
  const tokensToText = (toks: string[]) => normalise(toks.join(' '));
  const tokenize = (s: string) => normalise(s).split(/\s+/).filter(Boolean);
  const shingles = (toks: string[], k = 3) => {
    const out: string[] = [];
    for (let i = 0; i <= toks.length - k; i++) out.push(toks.slice(i, i + k).join(' '));
    return out;
  };

  const updateInputFromTokens = () => {
    setInput(tokensToText(committedTokensRef.current));
  };

  // append final text using word-level overlap detection + shingle dedupe
  const appendFinalTokens = (finalText: string) => {
    const newToks = tokenize(finalText);
    if (!newToks.length) return;

    // Overlap with last N words
    const cur = committedTokensRef.current;
    const N = 30;
    const tail = cur.slice(Math.max(0, cur.length - N));

    // find max overlap o where tail[-o:] == newToks[:o]
    let o = Math.min(tail.length, newToks.length);
    while (o > 0) {
      let match = true;
      for (let i = 0; i < o; i++) {
        if (tail[tail.length - o + i] !== newToks[i]) { match = false; break; }
      }
      if (match) break;
      o--;
    }

    const addition = newToks.slice(o);
    if (!addition.length) return; // nothing new

    // shingle dedupe: if most shingles already seen, ignore this chunk
    const newShingles = shingles(addition);
    let seenCount = 0;
    for (const s of newShingles) if (seenShinglesRef.current.has(s)) seenCount++;
    const seenRatio = newShingles.length ? seenCount / newShingles.length : 0;
    if (seenRatio > 0.9 && addition.length > 3) return;

    // commit (keep as array; join only for render)
    committedTokensRef.current = [...cur, ...addition];

    for (const s of newShingles) seenShinglesRef.current.add(s);
    updateInputFromTokens();
    lastFinalAtRef.current = Date.now();
  };

  const promoteInterimToFinal = () => {
    const t = interimTextRef.current.trim();
    if (!t) return;
    appendFinalTokens(t);
    interimTextRef.current = '';
  };

  // Styles
  useEffect(() => {
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
    setIsIOS(/iPhone|iPad|iPod/i.test(ua));
    const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
    const isSmallScreen = window.innerWidth < 640;
    setIsMobile(isMobileUA || isSmallScreen);

    const onResize = () => setIsMobile(isMobileUA || window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Scrolling / focus
  const scrollToBottom = useCallback(() => {
    if (!scrollerRef.current) return;
    requestAnimationFrame(() => { scrollerRef.current!.scrollTop = scrollerRef.current!.scrollHeight; });
  }, []);
  const handleScroll = useCallback(() => {
    if (!scrollerRef.current) return;
    const scrolled = scrollerRef.current.scrollTop > 20;
    if (scrolled !== headerBlur) setHeaderBlur(scrolled);
  }, [headerBlur]);

  useEffect(() => {
    if (inputRef.current) {
      if (!isRecording) inputRef.current.focus();
      if (!input) inputRef.current.style.height = 'auto';
      else adjustTextareaHeight(inputRef.current);
    }
  }, [input, isRecording]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { scrollToBottom(); }, [messages, isStreaming, scrollToBottom]);

  // Mic permission
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

  // Fresh recogniser per start/restart
  const createRecognizerAndStart = () => {
    const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SR) return 'fallback';

    const rec = new SR();
    // Force continuous for better gap handling on both Android and iOS Safari
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = 'en-GB';

    recognitionRef.current = rec;
    processedCursorRef.current = 0; // reset per session
    recStartAtRef.current = Date.now();

    rec.onstart = () => {
      // Keep UI in listening state across auto-restarts
      setIsRecording(true);
      setIsStarting(false);
      setListeningBadge('listening');

      // reset interim; keep committed
      interimTextRef.current = '';
      seenShinglesRef.current.clear();
      // Do NOT clear committedTokensRef here (otherwise you'd lose text)
      if (isMobile && inputRef.current) inputRef.current.blur();
    };

    rec.onaudiostart = () => setAudioActive(true);
    rec.onaudioend = () => setAudioActive(false);

    rec.onspeechend = () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => { if (wantRecordingRef.current) promoteInterimToFinal(); }, 220);
    };

    rec.onresult = (e: any) => {
      // Process each result once
      const interimParts: string[] = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (i < processedCursorRef.current) continue;
        const r = e.results[i];
        const t = (r[0]?.transcript ?? '').trim();
        if (!t) { processedCursorRef.current = Math.max(processedCursorRef.current, i + 1); continue; }
        if (r.isFinal) {
          appendFinalTokens(t);
          processedCursorRef.current = i + 1;
        } else {
          interimParts.push(t);
        }
      }
      interimTextRef.current = interimParts.join(' ').trim();

      // Protect last word
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => { if (wantRecordingRef.current) promoteInterimToFinal(); }, 360);
    };

    rec.onerror = (e: any) => {
      // If permissions denied, stop trying
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        wantRecordingRef.current = false;
        setIsRecording(false);
        setIsStarting(false);
        setListeningBadge('idle');
      }
      // Other errors handled by onend with restart
    };

    rec.onend = () => {
      // Flush any remaining interim quickly
      promoteInterimToFinal();
      if (settleTimerRef.current) { window.clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }

      if (wantRecordingRef.current && !isSending) {
        // Quick restart to bridge pauses
        const now = Date.now();
        const ranFor = now - recStartAtRef.current;
        const hadRecentFinal = lastFinalAtRef.current && now - lastFinalAtRef.current < 1000;
        // If recogniser ended quickly, increase delay a touch to avoid flapping
        if (ranFor < 600) restartCountRef.current += 1; else restartCountRef.current = 0;
        const backoff = Math.min(300, restartCountRef.current * 60);
        const base = hadRecentFinal ? 70 : 100; // near-immediate
        const delay = base + backoff;

        // Ensure old instance won’t fire stray events
        if (recognitionRef.current) {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current = null;
        }

        setTimeout(() => { if (wantRecordingRef.current) createRecognizerAndStart(); }, delay);
      } else {
        setListeningBadge('idle');
      }
    };

    try { rec.start(); } catch {}
    return 'ok';
  };

  const startRecording = async () => {
    if (isStarting || isSending) return;
    setIsStarting(true);
    setListeningBadge('starting');

    const ok = await ensureMicPermission();
    if (!ok) { setIsStarting(false); setListeningBadge('idle'); return; }

    wantRecordingRef.current = true;
    // carry over any typed text into tokens
    committedTokensRef.current = tokenize(tokensToText(committedTokensRef.current) || input);

    const status = createRecognizerAndStart();
    if (status === 'fallback') {
      // Fallback: MediaRecorder -> server STT on stop
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
            if (data?.text) appendFinalTokens(data.text);
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
        if (isMobile && inputRef.current) inputRef.current.blur();
      } catch {
        setIsStarting(false);
        setListeningBadge('idle');
      }
    }
  };

  const stopRecording = () => new Promise<void>((resolve) => {
    wantRecordingRef.current = false; // stop auto restarts
    setIsRecording(false);
    setIsStarting(false);
    setListeningBadge('idle');

    const GRACE = 150;
    const finish = () => {
      promoteInterimToFinal();
      const rec = recognitionRef.current;
      if (rec) {
        rec.onresult = null; rec.onerror = null; rec.onend = null;
        try { rec.stop(); } catch {}
        recognitionRef.current = null;
      }
      resolve();
    };

    if (recognitionRef.current) { window.setTimeout(finish, GRACE); return; }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.addEventListener('stop', () => resolve(), { once: true });
      mediaRecorderRef.current.stop();
      return;
    }
    resolve();
  });

  /* ---------------- Chat send/write ---------------- */

  const send = async () => {
    if (isRecording) await stopRecording();
    await sendWithPhase(false);
  };

  const writeLetter = async () => {
    if (isRecording) await stopRecording();
    await sendWithPhase(true);
  };

  const sendWithPhase = async (draft: boolean) => {
    const text = tokensToText(committedTokensRef.current);
    if (draft === false && !text) return;
    if (isStreaming || isSending) return;

    setIsSending(true);

    const nextMessages: Msg[] = text ? [...messages, { role: 'user', content: text }] : [...messages];
    setMessages(nextMessages);

    // clear composer
    committedTokensRef.current = [];
    interimTextRef.current = '';
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
        updated[holderIndex] = { role: 'assistant', content: `Network error: ${String((e as any)?.message ?? e)}` };
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
        updated[holderIndex] = { role: 'assistant', content: `Error ${res.status}: ${errText || 'Problem generating response'}` };
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
        if (updated[holderIndex]?.role === 'assistant') updated[holderIndex] = { role: 'assistant', content: accStr };
        return updated;
      });
    }

    const parsed = extractLetterBlocks(accStr);
    if (parsed.english || parsed.englishMD || parsed.translation || parsed.translationMD) {
      setMessages((prev) => {
        const before = parsed.before ? [{ role: 'assistant', content: parsed.before } as Msg] : [];
        const englishCard = (parsed.english || parsed.englishMD)
          ? [{ role: 'assistant', content: parsed.english || '', meta: { letter: 'en', md: parsed.englishMD || '' } as any }]
          : [];
        const translationCard = (parsed.translation || parsed.translationMD)
          ? [{ role: 'assistant', content: parsed.translation || '', meta: { letter: 'translation', md: parsed.translationMD || '', langLabel: parsed.translationLang || undefined } as any }]
          : [];
        const after = parsed.after ? [{ role: 'assistant', content: parsed.after } as Msg] : [];
        const updated = [...prev];
        updated.splice(holderIndex, 1, ...before, ...(englishCard as any), ...(translationCard as any), ...after);
        return updated;
      });
    }

    setIsStreaming(false);
    setIsSending(false);
    inputRef.current?.focus();
  };

  /* ---------------- Composer ---------------- */

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const adjustTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 96; // ~4 lines
    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    textarea.style.overflowY = scrollHeight > maxHeight ? 'scroll' : 'hidden';
    textarea.scrollTop = textarea.scrollHeight;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    committedTokensRef.current = tokenize(val);
    adjustTextareaHeight(e.target);
  };

  const TypingDots = () => {
    const [messageIndex, setMessageIndex] = useState(0);
    const typingMessages = ["AI is thinking","Analysing your request","Crafting your response","Almost ready"];
    useEffect(() => {
      const id = setInterval(() => setMessageIndex(p => (p + 1) % typingMessages.length), 2000);
      return () => clearInterval(id);
    }, []);
    return (
      <div className="flex items-center gap-2">
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-gradient-to-r from-sky-300 to-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="ml-1 text-sm text-gray-500">{typingMessages[messageIndex]}...</span>
      </div>
    );
  };

  const LetterBubble: React.FC<{ title: string; text: string; md?: string; index: number }> = ({ title, text, md, index }) => {
    const contentId = `letter-content-${index}`;
    return (
      <div className="mb-6 flex justify-start">
        <div className="max-w-[90%] rounded-3xl overflow-hidden border-2 border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-yellow-50/80 to-orange-50/70 backdrop-blur-md shadow-2xl ring-1 ring-amber-100/60 hover-lift group">
          <div className="flex items-center justify-between gap-3 border-b-2 border-amber-200/70 bg-gradient-to-r from-amber-100/60 via-yellow-100/50 to-amber-100/60 px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 via-yellow-600 to-orange-600 flex items-center justify-center shadow-lg">
                <SparkleIcon className="w-4 h-4 text-white" />
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
              {md?.trim() ? renderMarkdown(md) : text}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen w-full max-w-full overflow-hidden bg-gradient-to-br from-gray-100 via-gray-50 to-sky-100/50" style={{ height: '100vh', maxHeight: '100vh' }}>

      {/* Header */}
      <header className={`flex-shrink-0 flex items-center gap-4 px-3 h-14 bg-gradient-to-r from-sky-100 via-sky-200 to-sky-300 border-b border-gray-300 ${headerBlur ? 'shadow-lg' : ''}`}>
        <div className="relative">
          <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-sky-300 via-sky-400 to-sky-500 shadow-lg flex items-center justify-center">
            <span className="w-4 h-4 text-white">✉️</span>
          </div>
          <div className="absolute -right-1 -bottom-1 h-3 w-3 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 ring-2 ring-white shadow-sm animate-pulse-slow" title="Online" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900 font-sans">Complaint Letter Assistant</h1>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-0 space-y-2 bg-gradient-to-br from-white via-sky-50 to-sky-100 scrollbar-thin scrollbar-thumb-sky-200 scrollbar-track-transparent"
        style={{ minHeight: 0, overscrollBehavior: 'contain' }}
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md mx-auto px-4 animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-300 via-sky-400 to-sky-500 flex items-center justify-center mx-auto mb-4 shadow-lg animate-float">
                <span className="w-8 h-8 text-white">✉️</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Start Your Complaint</h2>
              <p className="text-gray-600 text-sm">Describe your housing issue or use the mic to speak.</p>
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
                    ? 'bg-gradient-to-r from-sky-300 to-sky-400 text-white rounded-br-md hover:from-sky-400 hover:to-sky-500'
                    : 'bg-white/80 text-gray-800 rounded-bl-md border border-gray-200/50 hover:bg-white/90 hover:border-gray-300/50'
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
              <span className="text-sky-600 flex items-center gap-2"><span className="animate-pulse">🎙️</span> Transcribing audio...</span>
            </div>
          </div>
        )}
      </div>

      {/* Composer: FLUSH, EDGE-TO-EDGE, NO SHADOWS */}
      <div
        className="flex-shrink-0 bg-white"
        style={{
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)'
        }}
      >
        <div className="flex items-center gap-2">
          {/* Draft */}
          <button
            onClick={writeLetter}
            disabled={isStreaming || isSending}
            className={[
              'h-11 transition-all duration-200 flex-shrink-0 flex items-center justify-center',
              'bg-gradient-to-r from-sky-300 via-sky-400 to-sky-500 text-white',
              'hover:from-sky-400 hover:via-sky-500 hover:to-sky-600',
              'disabled:opacity-50',
              'w-11 rounded-2xl sm:w-auto sm:px-5 sm:gap-2'
            ].join(' ')}
            title="Generate a formal complaint letter"
          >
            <PenIcon className="w-4 h-4" />
            <span className="hidden sm:inline font-medium text-sm">Draft Letter</span>
          </button>

          {/* Input + overlay (still visible, keyboard suppressed while recording) */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              placeholder={isRecording ? 'Listening… speak clearly' : 'Describe your housing issue...'}
              rows={1}
              readOnly={isRecording}
              inputMode={isRecording ? 'none' : undefined}
              className="w-full border border-gray-200/70 bg-white rounded-2xl px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400 transition-all duration-200 resize-none leading-5 h-11 max-h-24"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 transparent', paddingTop: '10px', paddingBottom: '10px', caretColor: isRecording ? 'transparent' as any : undefined }}
            />
            {/* Interim overlay (doesn't rewrite committed text) */}
            {isRecording && interimTextRef.current && (
              <div className="pointer-events-none absolute inset-0 rounded-2xl px-4 py-2 text-sm leading-5 flex items-center" aria-hidden="true">
                <span className="opacity-0 whitespace-pre-wrap">{input}{input ? ' ' : ''}</span>
                <span className="absolute left-4 right-4 top-1/2 -translate-y-1/2 text-gray-500/80 italic truncate">{interimTextRef.current}</span>
              </div>
            )}
            {listeningBadge !== 'idle' && (
              <div className="absolute -top-6 left-2 text-xs text-sky-600">
                {isStarting ? 'Starting mic…' : 'Listening…'}
              </div>
            )}
            {input.length > 100 && (
              <div className="absolute -top-6 right-2 text-xs text-gray-400">{input.length}/1000</div>
            )}
          </div>

          {/* Context button: Stop if recording; else Send if text; else Record */}
          {isRecording ? (
            <button
              type="button"
              onClick={() => { void stopRecording(); }}
              disabled={isStreaming || isSending}
              aria-label="Stop recording"
              className="relative w-11 h-11 rounded-2xl border flex-shrink-0 bg-gradient-to-r from-red-500 to-pink-600 border-red-500 text-white"
              title="Stop recording"
            >
              <MicIcon className="w-4 h-4 mx-auto" />
              {audioActive && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
            </button>
          ) : input.trim() ? (
            <button
              onClick={send}
              disabled={isStreaming || isSending}
              className="w-11 h-11 rounded-2xl bg-gradient-to-r from-sky-300 to-sky-400 text-white flex items-center justify-center"
              title="Send message"
            >
              <SendIcon className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={isStreaming || isSending || isStarting}
              aria-label="Start recording"
              className={`w-11 h-11 rounded-2xl border ${isStarting ? 'bg-gray-100 border-gray-200 text-gray-400' : 'bg-white border-gray-200 text-sky-600'}`}
              title="Start recording"
            >
              <MicIcon className="w-4 h-4 mx-auto" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
