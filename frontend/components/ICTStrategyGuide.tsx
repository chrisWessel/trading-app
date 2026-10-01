'use client';

import React, { useState } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, Compass, Layers, Zap, Target,
  Shield, TrendingUp, Lightbulb, GraduationCap, Repeat, CircleDot,
} from 'lucide-react';
// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionInfo {
  name: string;
  phase: string;
  in_killzone: boolean;
  trading_allowed: boolean;
  guidance: string;
  et_time: string;
  harare_time: string;
}

interface GuideAnalysis {
  session: SessionInfo;
  state_machine_state: string;
  current_price: number;
  asia_range: { high: number; low: number; label: string; high_swept: boolean; low_swept: boolean } | null;
  displacement: { confirmed: boolean; body_ratio: number; volume_ratio: number };
  sweep: { level: number; side: string; expected_direction: string } | null;
  signal: { status: string; direction: string; reason?: string };
  next_killzone: { label: string | null; countdown: string };
}

interface Props {
  analysis: GuideAnalysis;
}

// ─── Diagram primitives ──────────────────────────────────────────────────────

function Frame({ children, height = 120 }: { children: React.ReactNode; height?: number }) {
  return (
    <svg viewBox={`0 0 320 ${height}`} width="100%" className="block bg-slate-950/60 rounded-lg border border-slate-800" role="img">
      {children}
    </svg>
  );
}

function Candle({ x, o, h, l, c, w = 13, up = '#22c55e', dn = '#ef4444' }: { x: number; o: number; h: number; l: number; c: number; w?: number; up?: string; dn?: string }) {
  const color = c >= o ? up : dn;
  return (
    <g>
      <line x1={x} y1={h} x2={x} y2={l} stroke={color} strokeWidth={1.5} />
      <rect x={x - w / 2} y={Math.min(o, c)} width={w} height={Math.max(1.5, Math.abs(c - o))} fill={color} opacity={0.85} />
    </g>
  );
}

function Label({ x, y, text, color = '#cbd5e1', size = 9, anchor = 'middle' }: { x: number | string; y: number | string; text: string; color?: string; size?: number; anchor?: 'start' | 'middle' | 'end' }) {
  return <text x={x} y={y} fill={color} fontSize={size} fontWeight="700" textAnchor={anchor} fontFamily="ui-monospace, monospace">{text}</text>;
}

// ─── Diagrams ────────────────────────────────────────────────────────────────

function AbcDiagram() {
  // Bullish ABC: A impulse up, B corrective pullback into OTE, C displacement up.
  const oteTop = 46;
  const oteBot = 60;
  return (
    <Frame height={140}>
      <rect x="96" y={oteTop} width="150" height={oteBot - oteTop} fill="#10b981" opacity={0.14} />
      <Label x={171} y={oteTop + 10} text="OTE 0.62–0.79" color="#34d399" size={8} />

      {/* A leg */}
      <line x1="24" y1="118" x2="104" y2="30" stroke="#38bdf8" strokeWidth={2.5} />
      <circle cx="24" cy="118" r="3" fill="#38bdf8" />
      <circle cx="104" cy="30" r="3" fill="#38bdf8" />
      <Label x="62" y="70" text="A" color="#38bdf8" size={11} />

      {/* B leg into OTE */}
      <line x1="104" y1="30" x2="172" y2={56} stroke="#f59e0b" strokeWidth={2.5} />
      <circle cx="172" cy="56" r="3" fill="#f59e0b" />
      <Label x="140" y="46" text="B" color="#f59e0b" size={11} />

      {/* C leg displacement */}
      <line x1="172" y1="56" x2="286" y2="20" stroke="#22c55e" strokeWidth={3} />
      <circle cx="286" cy="20" r="3.5" fill="#22c55e" />
      <Label x="232" y="42" text="C" color="#22c55e" size={11} />

      {/* entry marker at B terminus */}
      <rect x="164" y="56" width="16" height="30" fill="#22c55e" opacity={0.22} />
      <Label x="172" y="102" text="ENTRY" color="#22c55e" size={8} />
      <Label x="172" y="112" text="MARKET" color="#22c55e" size={7} />
      <Label x="286" y="132" text="target" color="#64748b" size={8} />
      <Label x="24" y="132" text="origin" color="#64748b" size={8} anchor="start" />
    </Frame>
  );
}

function FvgDiagram() {
  // Bullish FVG: candle 1 high < candle 3 low, leaving an untraded gap.
  return (
    <Frame height={118}>
      <Candle x={80} o={70} h={78} l={52} c={56} />
      <Candle x={140} o={58} h={64} l={50} c={62} />
      <Candle x={200} o={60} h={70} l={30} c={34} />

      <rect x="87" y={30} width="106" height={20} fill="#10b981" opacity={0.2} />
      <rect x="87" y="30" width="106" height="20" fill="none" stroke="#10b981" strokeWidth={1} strokeDasharray="3 2" />
      <Label x="140" y="20" text="BULLISH FVG" color="#34d399" size={9} />
      <Label x="140" y="44" text="gap = imbalance" color="#6ee7b7" size={7.5} />

      <Label x="80" y="92" text="c1" color="#64748b" size={8} />
      <Label x="140" y="92" text="c2" color="#64748b" size={8} />
      <Label x="200" y="92" text="c3" color="#64748b" size={8} />
      <Label x="270" y="70" text="c1.high < c3.low" color="#94a3b8" size={8} anchor="start" />
      <Label x="270" y="82" text="→ unfilled space" color="#94a3b8" size={8} anchor="start" />
    </Frame>
  );
}

function IfvgDiagram() {
  // Bearish gap, then a body close above its top flips it bullish.
  return (
    <Frame height={132}>
      <Candle x={64} o={40} h={52} l={38} c={50} />
      <Candle x={112} o={50} h={54} l={44} c={46} />
      <Candle x={160} o={46} h={48} l={30} c={32} />
      <rect x="70" y={30} width="84" height={16} fill="#ef4444" opacity={0.2} />
      <rect x="70" y="30" width="84" height="16" fill="none" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 2" />
      <Label x="112" y="22" text="BEARISH FVG" color="#f87171" size={8.5} />

      <line x1="196" y1="26" x2="268" y2="26" stroke="#f87171" strokeWidth={1} strokeDasharray="2 3" />
      <Label x="272" y="29" text="gap top" color="#f87171" size={7.5} anchor="start" />

      <Candle x={232} o={40} h={24} l={36} c={22} />
      <line x1="224" y1="26" x2="248" y2="26" stroke="#22c55e" strokeWidth={2.5} />
      <Label x="258" y="18" text="body CLOSE above" color="#34d399" size={8} anchor="start" />

      <rect x="70" y="52" width="150" height="18" fill="#22c55e" opacity={0.16} />
      <Label x="145" y="64" text="now acts as SUPPORT" color="#34d399" size={8} />
      <Label x="145" y="94" text="VALID IFVG LONG" color="#22c55e" size={10} />
    </Frame>
  );
}

function SweepDiagram() {
  return (
    <Frame height={124}>
      <line x1="16" y1="34" x2="304" y2="34" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 3" />
      <Label x="20" y="27" text="EQUAL HIGHS — stops sit above" color="#fbbf24" size={8} anchor="start" />

      <Candle x={90} o={44} h={52} l={42} c={50} />
      <Candle x={150} o={50} h={58} l={46} c={54} />
      <Candle x={216} o={54} h={46} l={20} c={22} />

      <circle cx="216" cy="34" r="4.5" fill="none" stroke="#f87171" strokeWidth={2} />
      <Label x="216" y="12" text="SWEEP" color="#f87171" size={9} />
      <Label x="216" y="60" text="wick took stops," color="#94a3b8" size={8} />
      <Label x="216" y="71" text="no acceptance above" color="#94a3b8" size={8} />

      <line x1="228" y1="22" x2="300" y2="22" stroke="#22c55e" strokeWidth={1} strokeDasharray="2 3" />
      <Label x="298" y="14" text="→ expect reversal SHORT" color="#22c55e" size={8} anchor="end" />
    </Frame>
  );
}

function AmdDiagram() {
  return (
    <Frame height={150}>
      {/* Asia accumulation */}
      <line x1="24" y1="112" x2="126" y2="112" stroke="#6366f1" strokeWidth={2} />
      <line x1="24" y1="60" x2="126" y2="60" stroke="#6366f1" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
      <Label x="75" y="128" text="ASIA 19:00–02:00" color="#a5b4fc" size={8} />
      <Label x="75" y="52" text="range forms" color="#818cf8" size={7.5} />
      <Label x="75" y="34" text="ACCUMULATION" color="#c7d2fe" size={9} />

      {/* London manipulation */}
      <line x1="126" y1="112" x2="126" y2="40" stroke="#f43f5e" strokeWidth={2.5} />
      <circle cx="126" cy="40" r="4" fill="#f43f5e" />
      <Label x="160" y="36" text="sweep the Asia high" color="#fda4af" size={8} anchor="start" />
      <Label x="176" y="128" text="LONDON 02:00–05:00" color="#6ee7b7" size={8} />
      <Label x="176" y="104" text="MANIPULATION" color="#34d399" size={9} />

      {/* distribution */}
      <line x1="176" y1="112" x2="248" y2="112" stroke="#22c55e" strokeWidth={2.5} />
      <Label x="212" y="72" text="deliver away" color="#86efac" size={8} />
      <Label x="212" y="88" text="DISTRIBUTION" color="#22c55e" size={9} />

      {/* NY */}
      <line x1="248" y1="112" x2="300" y2="112" stroke="#fb7185" strokeWidth={2.5} />
      <Label x="274" y="60" text="NEW YORK 09:00–10:00" color="#fda4af" size={7.5} anchor="end" />
      <Label x="274" y="104" text="RTH gap" color="#fda4af" size={7.5} anchor="end" />
    </Frame>
  );
}

// ─── Reusable pieces ─────────────────────────────────────────────────────────

function Step({
  n, title, subtitle, icon, children, defaultOpen = false,
}: { n: number; title: string; subtitle: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-900/70 transition"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
        <span className="w-5 h-5 rounded-md bg-blue-900/70 border border-blue-700 text-blue-300 text-[10px] font-black flex items-center justify-center shrink-0">
          {n}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-black text-slate-100">
          {icon}
          {title}
        </span>
        <span className="ml-auto text-[10px] text-slate-500 truncate max-w-[45%]">{subtitle}</span>
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-1 text-[11px] text-slate-300 leading-relaxed space-y-2">{children}</div>}
    </div>
  );
}

function Key({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'bull' | 'bear' | 'amber' }) {
  const map = {
    slate: 'bg-slate-900 text-slate-300 border-slate-700',
    bull: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    bear: 'bg-rose-950 text-rose-300 border-rose-800',
    amber: 'bg-amber-950 text-amber-300 border-amber-800',
  };
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${map[tone]}`}>{children}</span>;
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-slate-800/70 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-100 font-bold text-right">{value}</span>
    </div>
  );
}

const GLOSSARY: { term: string; short: string; long: string }[] = [
  { term: 'AMD', short: 'Accumulation · Manipulation · Distribution', long: 'The daily three-act structure. Asia accumulates liquidity, London manipulates by taking it, price then distributes in the opposite direction.' },
  { term: 'Killzone', short: 'The only times you may trade', long: 'London 02:00–05:00 ET and New York 09:00–10:00 ET. Outside these the strategy refuses to signal, because volatility and participation are too low.' },
  { term: 'Liquidity pool', short: 'Where stop orders rest', long: 'Equal highs, equal lows, Asia range extremes, previous day high/low. Price is magnetically drawn to these because that is where the stops are.' },
  { term: 'Sweep', short: 'Stops taken, price rejected', long: 'A wick beyond a pool followed by a close back inside. It proves the level was raided and rejected — the trigger for the setup.' },
  { term: 'Displacement', short: 'Fast, committed move', long: 'A candle with body above 75% of its range on expanded volume. It is the evidence that institutions, not retail, drove the move.' },
  { term: 'FVG', short: 'Fair Value Gap — a 3-candle imbalance', long: 'When candle 1 high is below candle 3 high, the wick area between was not traded on one side. Market often returns to fill it.' },
  { term: 'IFVG', short: 'Inverted FVG — the A+ trigger', long: 'When a gap is filled and a candle body closes beyond its far boundary, it flips polarity: an old resistance becomes support. This is the conservative entry.' },
  { term: 'Order block', short: 'The last opposing candle before the move', long: 'The candle that originated the displacement. Your stop goes behind it — if price trades through it, your premise is invalid.' },
  { term: 'MSS', short: 'Market Structure Shift', long: 'The displacement candle that breaks the prior swing in the trade direction, confirming the trend has changed hands.' },
  { term: 'OTE', short: 'Optimal Trade Entry, 0.62–0.79', long: 'The Fibonacci band where the B leg of the ABC pattern should terminate before the C leg displaces.' },
  { term: 'Premium / Discount', short: 'Half of the dealing range', long: 'Above 50% of the range is premium (favourable to sell), below is discount (favourable to buy). Never buy in premium or sell in discount.' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ICTStrategyGuide({ analysis }: Props) {
  const [showGlossary, setShowGlossary] = useState(false);
  const { session, asia_range: asia, displacement, sweep, signal } = analysis;

  const ready = signal.status === 'ENTRY_READY';
  const isLong = signal.direction === 'LONG';

  // Where the user sits in the daily three-act cycle right now.
  const stage = session.name === 'ASIA' ? 0 : session.name === 'LONDON' ? 1 : session.name === 'NEW YORK' ? 2 : 1;

  const narrative = (() => {
    if (session.name === 'ASIA') {
      return {
        headline: 'You are in ASIA — the accumulation phase. Do not trade yet.',
        body: [
          `Asia runs 19:00–02:00 ET and its only job is to build a range that someone will later raid. Right now it has produced a high of ${asia ? asia.high : '—'} and a low of ${asia ? asia.low : '—'}.`,
          'Those two numbers are the targets for the next session. Institutions need visible liquidity before they can push price, and Asia manufactures exactly that.',
          'Your job now is to watch, not to trade. Mark the range, place alerts on both edges, and wait for London.',
        ],
      };
    }
    if (session.name === 'LONDON' && session.phase === 'MANIPULATION') {
      return {
        headline: 'You are in LONDON manipulation — the first hour after 02:00 ET. This is the trap.',
        body: [
          'London opens by raiding one side of the Asia range. That raid is deliberate: it is designed to make early longs or shorts feel right, so retail piles in on the wrong side.',
          sweep
            ? `A sweep has already registered at ${sweep.level} (${sweep.side === 'BUY_SIDE' ? 'equal highs' : 'equal lows'}), pointing to a ${sweep.expected_direction}.`
            : 'No sweep has registered yet — price has not committed to a side.',
          'Wait for the raid, then for displacement. Entering before the raid is how this setup loses money.',
        ],
      };
    }
    if (session.name === 'LONDON') {
      return {
        headline: 'You are in LONDON distribution — the real trade window is open.',
        body: [
          'Manipulation is over and price should now be delivering away from the swept side. This is the highest-quality window of the London session.',
          displacement.confirmed
            ? `Displacement is confirmed (body ${(displacement.body_ratio * 100).toFixed(0)}%, volume ${displacement.volume_ratio.toFixed(2)}× the 20-bar mean) — the move is genuine.`
            : 'Displacement has not confirmed yet. A wide candle is not enough; it needs a large body AND expanded volume.',
          ready
            ? 'The full chain is satisfied and the engine has marked the entry. Execute on the 1-minute with a market order.'
            : 'Watch for an IFVG inversion to close the chain.',
        ],
      };
    }
    if (session.name === 'NEW_YORK') {
      return {
        headline: 'You are in NEW YORK — RTH acceleration. This is the highest-volatility window.',
        body: [
          'The 09:30 ET regular-trading-hours open injects volume that London never sees. Gaps get filled and expansion is violent.',
          'Expect tighter, faster displacement and wider stop allowances — the session cap scales up for this reason.',
          ready
            ? 'Signal is armed. Same execution rules: 1-minute chart, market order, stop behind the order block.'
            : 'Stand by until a sweep plus displacement plus IFVG all align.',
        ],
      };
    }
    return {
      headline: 'You are OUTSIDE the killzones. The correct trade is no trade.',
      body: [
        `Next window opens in ${analysis.next_killzone.countdown}.`,
        'This strategy deliberately refuses to signal here. Outside London and New York the market lacks the participation needed for displacement, so any "setup" you find is noise.',
        'Use the time to draw levels, set alerts on the Asia edges, and plan size and stop placement.',
      ],
    };
  })();

  const STAGES = [
    { name: 'ASIA', time: '19:00–02:00 ET', role: 'Accumulation', done: stage > 0, current: stage === 0 },
    { name: 'LONDON', time: '02:00–05:00 ET', role: 'Manipulate → Distribute', done: stage > 1, current: stage === 1 },
    { name: 'NEW YORK', time: '09:00–10:00 ET', role: 'RTH expansion', done: stage > 2, current: stage === 2 },
  ];

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 font-mono space-y-4">

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-black text-slate-100">
          <BookOpen className="w-4 h-4 text-blue-400" /> How this strategy actually works
        </span>
        <span className="text-[10px] text-slate-500">Step-by-step guide · {session.et_time} ET</span>
      </div>

      {/* ── WHERE YOU ARE RIGHT NOW ──────────────────────────────────────── */}
      <div className={`rounded-lg border p-3 ${
        ready ? 'border-emerald-600/60 bg-emerald-950/30'
             : session.in_killzone ? 'border-amber-700/60 bg-amber-950/20'
             : 'border-slate-700 bg-slate-950/60'
      }`}>
        <div className="flex items-start gap-2.5">
          <div className={`p-2 rounded-lg shrink-0 ${
            ready ? 'bg-emerald-900/60 text-emerald-300'
                 : session.in_killzone ? 'bg-amber-900/50 text-amber-300'
                 : 'bg-slate-800 text-slate-400'
          }`}>
            {ready ? <CircleDot className="w-4 h-4" /> : <Compass className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black text-white">{narrative.headline}</div>
            <div className="mt-1.5 space-y-1.5">
              {narrative.body.map((p, i) => (
                <p key={i} className="text-[11px] text-slate-300 leading-relaxed">{p}</p>
              ))}
            </div>
          </div>
        </div>

        {/* Stage stepper */}
        <div className="flex items-stretch gap-1.5 mt-3">
          {STAGES.map((s, i) => (
            <React.Fragment key={s.name}>
              <div className={`flex-1 rounded-md border px-2 py-1.5 text-center ${
                s.current ? 'border-blue-500/70 bg-blue-950/40'
                         : s.done ? 'border-emerald-800/50 bg-emerald-950/20'
                         : 'border-slate-800 bg-slate-900/50'
              }`}>
                <div className={`text-[10px] font-black ${
                  s.current ? 'text-blue-300' : s.done ? 'text-emerald-400/80' : 'text-slate-500'
                }`}>
                  {s.done && !s.current ? '✓ ' : ''}{s.name}
                </div>
                <div className="text-[9px] text-slate-500">{s.time}</div>
                <div className="text-[9px] text-slate-600">{s.role}</div>
              </div>
              {i < STAGES.length - 1 && <div className="self-center text-slate-700 text-[10px]">→</div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <AmdDiagram />

      {/* ── STEP BY STEP ─────────────────────────────────────────────────── */}
      <div className="space-y-2">

        <Step n={1} title="The AMD framework" subtitle="Why the day has a shape" icon={<Layers className="w-3.5 h-3.5 text-indigo-400" />} defaultOpen>
          <p>
            Markets do not trend all day. They repeat a three-act structure, and each session has a role in it.
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li><Key tone="slate">ACCUMULATION (Asia)</Key> — price coils into a range. It looks boring. That is the point: a tight range collects resting orders.</li>
            <li><Key tone="bear">MANIPULATION (London open)</Key> — price spikes through one edge of that range, taking stops and triggering late entries.</li>
            <li><Key tone="bull">DISTRIBUTION</Key> — price rejects the raid and travels in the opposite direction, filling the liquidity that was left behind.</li>
          </ul>
          <p>
            The trade is never "buy low, sell high". It is <strong>wait for the raid, then join the direction it was hiding</strong>.
          </p>
        </Step>

        <Step n={2} title="Liquidity pools — where the stops are" subtitle="Equal highs, Asia edges, PDH/PDL" icon={<Target className="w-3.5 h-3.5 text-amber-400" />}>
          <p>
            Price moves toward obvious levels because the orders waiting there fund the move. The three pools this strategy uses:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li><Key tone="amber">ASIA HIGH / LOW</Key> — the range extremes built overnight. Everyone watches them, so everyone&apos;s stop sits beyond them.</li>
            <li><Key tone="amber">EQUAL HIGHS / LOWS (LRLR)</Key> — repeated swing highs or lows. These are the weakest structure on the chart and get hunted first.</li>
            <li><Key tone="amber">PREVIOUS DAY HIGH / LOW</Key> — the daily range other participants are watching for the same reason.</li>
          </ul>
          <p>
            Your chart marks all of these. Right now:{' '}
            {asia ? (
              <>Asia high <Key tone="amber">{asia.high}</Key>, Asia low <Key tone="amber">{asia.low}</Key>, {sweep ? <>latest sweep at <Key tone="bear">{sweep.level}</Key></> : 'no sweep yet'}.</>
            ) : 'the Asia range is still building.'}
          </p>
        </Step>

        <Step n={3} title="The liquidity sweep — your trigger" subtitle="Stops taken, price rejected" icon={<Zap className="w-3.5 h-3.5 text-rose-400" />}>
          <p>
            A sweep is a wick <em>beyond</em> a pool followed by a close <em>back inside</em>. Both halves matter. A wick alone is a breakout; a wick plus a close back inside is a rejection.
          </p>
          <SweepDiagram />
          <p>
            Sweeping <Key tone="bear">buy-side</Key> liquidity (highs) implies you should look <Key tone="bull">SHORT</Key>. Sweeping <Key tone="bull">sell-side</Key> liquidity (lows) implies <Key tone="bear">LONG</Key>. The pool that gets taken tells you which side is being trapped.
          </p>
        </Step>

        <Step n={4} title="Displacement — proving the move is real" subtitle="Body &gt; 75% of range on volume" icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}>
          <p>
            After a sweep, price must move away fast enough to prove it is real distribution rather than a bounce. Two conditions, both required:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li><Key tone="bull">BODY &gt; 75% OF RANGE</Key> — almost no wicks. A wide candle full of rejection is not displacement.</li>
            <li><Key tone="bull">VOLUME ABOVE THE 20-BAR MEAN</Key> — participation. Displacement on thin volume is easily reversed.</li>
          </ul>
          <p>
            This is the displacement candle. It breaks the prior swing in your direction, which is a <Key tone="slate">market structure shift</Key> — the confirmation that control has changed hands.
          </p>
        </Step>

        <Step n={5} title="Fair Value Gap — the inefficiency" subtitle="3-candle imbalance" icon={<Layers className="w-3.5 h-3.3 text-violet-400" />}>
          <p>
            When price moves so fast that one side of a candle is never offered, that untraded space is a <strong>Fair Value Gap</strong>. It is a footprint of the imbalance that caused the displacement.
          </p>
          <FvgDiagram />
          <p>
            FVGs matter because the market frequently returns to fill them before continuing. They are also where a <Key tone="bull">stop</Key> naturally belongs — inside the gap, behind the order block that created it.
          </p>
        </Step>

        <Step n={6} title="Inverted FVG — the A+ entry" subtitle="Body close through the gap" icon={<Repeat className="w-3.5 h-3.3 text-emerald-400" />}>
          <p>
            A gap filled and then <em>closed through</em> by a candle body changes polarity. Old resistance becomes support. This is the conservative entry, and it is why the system waits rather than front-running the sweep.
          </p>
          <IfvgDiagram />
          <p>
            The rule this engine enforces precisely: a <strong>wick</strong> through the boundary is not an inversion. It requires a <Key tone="bull">body close</Key> beyond it. Loosening that is how these systems start producing noise.
          </p>
        </Step>

        <Step n={7} title="The ABC pattern and execution" subtitle="Where to click" icon={<CircleDot className="w-3.5 h-3.3 text-blue-400" />}>
          <p>
            The whole London sequence usually resolves into an <strong>ABC correction</strong>:
          </p>
          <AbcDiagram />
          <ul className="list-disc pl-4 space-y-1">
            <li><Key tone="bull">A</Key> — the impulse leg away from origin.</li>
            <li><Key tone="amber">B</Key> — the corrective pullback. It should terminate inside the <Key tone="amber">OTE 0.62–0.79</Key> band of A, in <strong>discount</strong> (the lower half of the dealing range) for a long.</li>
            <li><Key tone="bull">C</Key> — the displacement leg that leaves the FVG or inverts it.</li>
          </ul>
          <p>
            Execution rules from the strategy: <Key tone="slate">market order, never a limit</Key>, on the 1-minute, with 15s/30s candles used only to judge speed. You are buying the momentum that is already there, not predicting it.
          </p>
          <p>
            Do not buy in <strong>premium</strong> (upper half of the range) and do not sell in <strong>discount</strong>. That single filter removes most losing trades.
          </p>
        </Step>

        <Step n={8} title="Risk, targets and management" subtitle="Where the stop goes" icon={<Shield className="w-3.5 h-3.3 text-rose-400" />}>
          <p>
            The stop is structural, not arbitrary: <strong>behind the order block</strong> — the last opposing candle before the displacement. If price trades through it, your premise is invalid and you should be out.
          </p>
          <div className="bg-slate-900 border border-slate-800 rounded-md p-2 my-1">
            <Rule label="London stop cap" value="25 reference points" />
            <Rule label="New York stop cap" value="40 reference points" />
            <Rule label="Minimum R:R" value="1:2, no exceptions" />
            <Rule label="Target" value="nearest 1H FVG or opposing liquidity" />
            <Rule label="Invalidation" value="ENTRY_CANCELLED if the stop exceeds the cap" />
            <Rule label="Management" value="trail to break-even at 1.5R or a minor pool sweep" />
          </div>
          <p>
            The caps are quoted in NQ index points and <strong>scaled by ATR</strong> in this build, so they keep their economic meaning on gold, FX and crypto. On NQ, where a 1-minute ATR is about 25, the caps land on exactly 25 and 40.
          </p>
          <p>
            Position size follows confluence. Five factors aligned (daily FVG, 1H FVG, sweep, displacement, IFVG) is an <Key tone="bull">A+</Key> and takes increased size; fewer factors means standard size or no trade.
          </p>
        </Step>
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50">
        <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-amber-200/90 leading-relaxed">
          The engine only signals when it is in London or New York, because outside those windows the strategy deliberately refuses to act. A quiet screen is the system working correctly — not a fault.
        </p>
      </div>

      {/* ── GLOSSARY ─────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setShowGlossary(g => !g)}
          className="w-full flex items-center gap-2 text-xs font-black text-slate-100 hover:text-white transition"
        >
          {showGlossary ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
          <GraduationCap className="w-4 h-4 text-blue-400" /> Glossary ({GLOSSARY.length} terms)
        </button>
        {showGlossary && (
          <div className="mt-2 space-y-1.5">
            {GLOSSARY.map(g => (
              <div key={g.term} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[11px] font-black text-cyan-300">{g.term}</span>
                  <span className="text-[10px] text-slate-400">{g.short}</span>
                </div>
                <p className="mt-1 text-[10.5px] text-slate-400 leading-relaxed">{g.long}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
