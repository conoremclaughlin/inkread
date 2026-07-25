'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  attributeSentences,
  castChapter,
  toggleSentenceSpeaker,
  type Chapter,
  type Speaker,
  type VoiceCast,
  type VoiceRule,
} from '@inkread/core';
import type { BookSummary } from '@/lib/data/repository';

const PALETTE = ['#8b5e3c', '#4a6d7c', '#5f7c4a', '#7d5f9c', '#a6564e', '#7c6f4a', '#4a7c8c'];

function speakerColor(speakers: Speaker[], id: string): string {
  const i = speakers.findIndex((s) => s.id === id);
  return i < 0 ? '#9aa0a6' : PALETTE[i % PALETTE.length]!;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `s-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCast(bookId: string): VoiceCast {
  const narrator: Speaker = { id: newId(), name: 'Narrator', voiceId: '' };
  return { bookId, speakers: [narrator], rules: [], defaultSpeakerId: narrator.id };
}

interface Props {
  book: BookSummary;
  chapters: Chapter[];
  initialCast: VoiceCast | null;
}

export function VoiceEditor({ book, chapters, initialCast }: Props) {
  const [cast, setCast] = useState<VoiceCast>(
    initialCast && initialCast.speakers.length > 0 ? initialCast : defaultCast(book.id),
  );
  const [chapterIndex, setChapterIndex] = useState(0);
  const [activeSpeakerId, setActiveSpeakerId] = useState(cast.speakers[0]!.id);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number>();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener('voiceschanged', load);
    return () => synth.removeEventListener('voiceschanged', load);
  }, []);

  const chapter = chapters[chapterIndex]!;
  const attributed = useMemo(
    () => attributeSentences(chapter.paragraphs, chapterIndex, cast),
    [chapter.paragraphs, chapterIndex, cast],
  );

  // --- speaker + rule editing -------------------------------------------
  const patch = (fn: (c: VoiceCast) => VoiceCast) => setCast(fn);

  const addSpeaker = () => {
    const speaker: Speaker = { id: newId(), name: `Speaker ${cast.speakers.length}`, voiceId: '' };
    patch((c) => ({ ...c, speakers: [...c.speakers, speaker] }));
    setActiveSpeakerId(speaker.id);
  };
  const updateSpeaker = (id: string, fields: Partial<Speaker>) =>
    patch((c) => ({
      ...c,
      speakers: c.speakers.map((s) => (s.id === id ? { ...s, ...fields } : s)),
    }));
  const removeSpeaker = (id: string) =>
    patch((c) => {
      if (c.speakers.length <= 1) return c;
      const speakers = c.speakers.filter((s) => s.id !== id);
      return {
        ...c,
        speakers,
        rules: c.rules.filter((r) => r.speakerId !== id),
        defaultSpeakerId: c.defaultSpeakerId === id ? speakers[0]!.id : c.defaultSpeakerId,
      };
    });

  const addRule = (rule: VoiceRule) => patch((c) => ({ ...c, rules: [...c.rules, rule] }));
  const updateRule = (index: number, rule: VoiceRule) =>
    patch((c) => ({ ...c, rules: c.rules.map((r, i) => (i === index ? rule : r)) }));
  const removeRule = (index: number) =>
    patch((c) => ({ ...c, rules: c.rules.filter((_, i) => i !== index) }));

  const assignSentence = (start: number, end: number) =>
    patch((c) => ({
      ...c,
      rules: toggleSentenceSpeaker(c.rules, chapterIndex, start, end, activeSpeakerId),
    }));

  // --- playback ----------------------------------------------------------
  const play = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const byUri = new Map(voices.map((v) => [v.voiceURI, v]));
    const segments = castChapter(chapter.paragraphs, chapterIndex, cast);
    segments.forEach((seg, i) => {
      const u = new SpeechSynthesisUtterance(seg.text);
      const v = seg.voiceId ? byUri.get(seg.voiceId) : undefined;
      if (v) u.voice = v;
      if (i === segments.length - 1) u.onend = () => setPlaying(false);
      synth.speak(u);
    });
    setPlaying(segments.length > 0);
  }, [voices, chapter.paragraphs, chapterIndex, cast]);

  const stop = () => {
    window.speechSynthesis?.cancel();
    setPlaying(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/books/${book.id}/voice-cast`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cast),
      });
      if (res.ok) setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const patternRules = cast.rules
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: Extract<VoiceRule, { kind: 'pattern' }>; i: number } => x.r.kind === 'pattern');

  const speakerName = (id: string) => cast.speakers.find((s) => s.id === id)?.name ?? '—';

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <a href={`/read/${book.id}`} className="text-sm opacity-60 hover:opacity-100">
            ← Back to reader
          </a>
          <h1 className="text-xl font-semibold">Voice cast · {book.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          {savedAt ? <span className="text-xs opacity-60">Saved</span> : null}
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-full bg-[#8b5e3c] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save cast'}
          </button>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[20rem_1fr]">
        {/* Speakers + rules */}
        <aside className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">Speakers</h2>
            <ul className="space-y-2">
              {cast.speakers.map((s) => (
                <li key={s.id} className="rounded-lg border p-2" style={{ borderColor: '#0002' }}>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: speakerColor(cast.speakers, s.id) }}
                    />
                    <input
                      value={s.name}
                      onChange={(e) => updateSpeaker(s.id, { name: e.target.value })}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                    <label className="flex items-center gap-1 text-xs opacity-70" title="Narrator / default">
                      <input
                        type="radio"
                        checked={cast.defaultSpeakerId === s.id}
                        onChange={() => patch((c) => ({ ...c, defaultSpeakerId: s.id }))}
                      />
                      def
                    </label>
                    {cast.speakers.length > 1 ? (
                      <button onClick={() => removeSpeaker(s.id)} className="text-xs opacity-50 hover:opacity-100">
                        ✕
                      </button>
                    ) : null}
                  </div>
                  <select
                    value={s.voiceId}
                    onChange={(e) => updateSpeaker(s.id, { voiceId: e.target.value })}
                    className="mt-2 w-full rounded border bg-transparent p-1 text-xs"
                    style={{ borderColor: '#0002' }}
                  >
                    <option value="">Default voice</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <button onClick={addSpeaker} className="mt-2 text-sm font-medium text-[#8b5e3c]">
              + Add speaker
            </button>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
              Grep rules
            </h2>
            <ul className="space-y-2">
              {patternRules.map(({ r, i }) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={r.pattern}
                    onChange={(e) => updateRule(i, { ...r, pattern: e.target.value })}
                    placeholder="regex"
                    className="min-w-0 flex-1 rounded border bg-transparent p-1 font-mono text-xs"
                    style={{ borderColor: '#0002' }}
                  />
                  <select
                    value={r.speakerId}
                    onChange={(e) => updateRule(i, { ...r, speakerId: e.target.value })}
                    className="rounded border bg-transparent p-1 text-xs"
                    style={{ borderColor: '#0002' }}
                  >
                    {cast.speakers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => removeRule(i)} className="text-xs opacity-50 hover:opacity-100">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <button
                onClick={() => addRule({ kind: 'pattern', pattern: '', speakerId: activeSpeakerId })}
                className="font-medium text-[#8b5e3c]"
              >
                + Rule
              </button>
              <button
                onClick={() => addRule({ kind: 'pattern', pattern: '^["“]', speakerId: activeSpeakerId })}
                className="opacity-70 hover:opacity-100"
                title="Sentences that open with a quote"
              >
                + Quoted dialogue
              </button>
            </div>
          </section>
        </aside>

        {/* Chapter preview + click-to-assign */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <select
              value={chapterIndex}
              onChange={(e) => setChapterIndex(Number(e.target.value))}
              className="rounded border bg-transparent p-1 text-sm"
              style={{ borderColor: '#0002' }}
            >
              {chapters.map((c, i) => (
                <option key={i} value={i}>
                  {i + 1}. {c.title}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm">
              Assign clicks to:
              <select
                value={activeSpeakerId}
                onChange={(e) => setActiveSpeakerId(e.target.value)}
                className="rounded border bg-transparent p-1 text-sm"
                style={{ borderColor: '#0002' }}
              >
                {cast.speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {playing ? (
              <button onClick={stop} className="rounded-full border px-3 py-1 text-sm" style={{ borderColor: '#0003' }}>
                ■ Stop
              </button>
            ) : (
              <button onClick={play} className="rounded-full border px-3 py-1 text-sm" style={{ borderColor: '#0003' }}>
                ▶ Play chapter
              </button>
            )}
          </div>

          <p className="mb-3 text-xs opacity-60">
            Click a sentence to assign it to the selected speaker (click again to clear). Colours
            show who reads each line.
          </p>

          <div className="rounded-lg border p-4 leading-relaxed" style={{ borderColor: '#0002' }}>
            {attributed.length === 0 ? (
              <p className="opacity-60">This chapter has no text.</p>
            ) : (
              attributed.map((s) => (
                <button
                  key={`${s.start}-${s.end}`}
                  onClick={() => assignSentence(s.start, s.end)}
                  className="mr-1 rounded px-0.5 text-left transition hover:brightness-95"
                  style={{ background: `${speakerColor(cast.speakers, s.speakerId)}22` }}
                  title={`${speakerName(s.speakerId)} — click to assign to ${speakerName(activeSpeakerId)}`}
                >
                  {s.text}
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
