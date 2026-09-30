'use client';

import React from 'react';
import { Zap, Clock } from 'lucide-react';

// ─── Types (mirror backend/ict_engine.py session payloads) ────────────────────

export interface SessionWindow {
  name: string;
  purpose: string;
  is_killzone: boolean;
  opens_et: string;
  closes_et: string;
  opens_harare: string;
  closes_harare: string;
  status: string;
  countdown: string;
}

export interface NextKillzone {
  label: string | null;
  seconds_until: number | null;
  countdown: string;
  opens_et: string | null;
  opens_harare: string | null;
}

interface Props {
  windows: SessionWindow[];
  nextKillzone: NextKillzone;
  currentEt: string;      // "HH:MM" from the backend, so no client clock read
  currentHarare: string;
  inKillzone: boolean;
}

const BAND_STYLE: Record<string, { bar: string; chip: string; dot: string }> = {
  ASIA:      { bar: 'bg-indigo-500/35 border-indigo-400/50', chip: 'bg-indigo-950 text-indigo-300 border-indigo-800', dot: 'bg-indigo-400' },
  LONDON:    { bar: 'bg-emerald-500/35 border-emerald-400/60', chip: 'bg-emerald-950 text-emerald-300 border-emerald-800', dot: 'bg-emerald-400' },
  NEW_YORK:  { bar: 'bg-rose-500/35 border-rose-400/60', chip: 'bg-rose-950 text-rose-300 border-rose-800', dot: 'bg-rose-400' },
};

function toHours(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return (Number(h) || 0) + (Number(m) || 0) / 60;
}

// Asia wraps midnight (19:00 -> 02:00), so it is drawn as two segments.
function segmentsFor(win: SessionWindow): { left: number; width: number; wraps: boolean }[] {
  const start = toHours(win.opens_et);
  const end = toHours(win.closes_et);
  if (end > start) return [{ left: start, width: end - start, wraps: false }];
  return [
    { left: start, width: 24 - start, wraps: true },
    { left: 0, width: end, wraps: true },
  ];
}

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export default function SessionRibbon({ windows, nextKillzone, currentEt, currentHarare, inKillzone }: Props) {
  const nowPos = Math.min(100, Math.max(0, (toHours(currentEt) / 24) * 100));

  return (
    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 font-mono">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
          <Clock className="w-3.5 h-3.5 text-blue-400" /> 24-Hour Session Timeline (ET)
        </span>
        <span className="text-[11px] text-slate-400">
          Now <span className="text-white font-black">{currentEt}</span> ET
          <span className="text-slate-600"> / </span>
          <span className="text-white font-black">{currentHarare}</span> CAT
        </span>
      </div>

      {/* Track */}
      <div className="relative h-9 rounded-md bg-slate-900 border border-slate-800 overflow-hidden">
        {windows.map((w) => {
          const style = BAND_STYLE[w.name] || BAND_STYLE.ASIA;
          return segmentsFor(w).map((seg, i) => (
            <div
              key={`${w.name}-${i}`}
              className={`absolute top-0 bottom-0 border-x ${style.bar}`}
              style={{ left: `${(seg.left / 24) * 100}%`, width: `${(seg.width / 24) * 100}%` }}
              title={`${w.name} ${w.opens_et}-${w.closes_et} ET (${w.opens_harare}-${w.closes_harare} CAT)`}
            />
          ));
        })}

        {/* Hour grid */}
        {HOUR_TICKS.map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 w-px bg-slate-700/40"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}

        {/* Now marker */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.85)]" style={{ left: `${nowPos}%` }}>
          <div className="absolute -top-0.5 -translate-x-1/2 text-[9px] font-black text-white">▼</div>
        </div>
      </div>

      {/* Hour labels */}
      <div className="relative h-3.5 mt-0.5">
        {HOUR_TICKS.map((h) => (
          <span
            key={h}
            className="absolute text-[9px] text-slate-600 -translate-x-1/2"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {String(h % 24).padStart(2, '0')}
          </span>
        ))}
      </div>

      {/* Session chips + countdown */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {windows.map((w) => {
          const style = BAND_STYLE[w.name] || BAND_STYLE.ASIA;
          const live = w.status === 'LIVE';
          return (
            <span
              key={w.name}
              className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full border ${style.chip} ${
                live ? 'ring-1 ring-emerald-400/60' : 'opacity-70'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${style.dot} ${live ? 'animate-pulse' : ''}`} />
              {w.name}
              <span className="opacity-70">{w.opens_et}–{w.closes_et}</span>
              {w.is_killzone && <span className="text-amber-400">◆</span>}
            </span>
          );
        })}

        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-amber-800/60 bg-amber-950/40 text-amber-300">
          {inKillzone ? (
            <><Zap className="w-3.5 h-3.5" /> TRADE NOW</>
          ) : (
            <>
              <Clock className="w-3.5 h-3.5" />
              {nextKillzone.label ?? '—'} opens in
              <span className="text-white font-black text-xs">{nextKillzone.countdown}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}