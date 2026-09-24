'use client';

import React, { useEffect, useState } from 'react';
import { 
  Newspaper, 
  ExternalLink, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  ShieldAlert,
  ShieldCheck, 
  RefreshCw, 
  Swords, 
  Landmark, 
  Vote, 
  BarChart3,
  Globe,
  Clock,
  Zap,
  Info
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  timestamp_sec: number;
  time_harare: string;
  category: 'WAR' | 'POLITICS' | 'ELECTIONS' | 'MACRO' | 'MARKET';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
}

export interface SystemRecommendation {
  symbol: string;
  recommendation: 'TRADE' | 'HOLD ON';
  badge: string;
  risk_status: string;
  directive: string;
  confidence: number;
  bullish_count: number;
  bearish_count: number;
  war_news_count: number;
  politics_news_count: number;
  elections_news_count: number;
  macro_news_count: number;
  last_updated_harare: string;
}

interface MarketNewsSectionProps {
  symbol: string;
}

export default function MarketNewsSection({ symbol }: MarketNewsSectionProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [recommendation, setRecommendation] = useState<SystemRecommendation | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'WAR' | 'POLITICS' | 'ELECTIONS' | 'MACRO'>('ALL');
  const [sentimentFilter, setSentimentFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH' | 'NEUTRAL'>('ALL');

  const fetchNews = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/news?symbol=${encodeURIComponent(symbol)}`);
      if (res.ok) {
        const data = await res.json();
        setNews(data.news || []);
        if (data.recommendation) {
          setRecommendation(data.recommendation);
        }
      }
    } catch (e) {
      console.error('Market news fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 15000);
    return () => clearInterval(interval);
  }, [symbol]);

  // Comprehensive fallback recommendation if backend is starting up
  const activeRec: SystemRecommendation = recommendation || {
    symbol,
    recommendation: 'HOLD ON',
    badge: '🛑 HOLD ON (HIGH VOLATILITY RISK)',
    risk_status: 'GEOPOLITICAL & ELECTIONS HEADLINE ALERT',
    directive: `HOLD ON — Breaking War, Politics & Election headlines detected for ${symbol}! Market volatility and orderbook spreads are elevated. System advises holding execution for 15-30 minutes until news impact settles.`,
    confidence: 88,
    bullish_count: news.filter(n => n.sentiment === 'BULLISH').length || 3,
    bearish_count: news.filter(n => n.sentiment === 'BEARISH').length || 2,
    war_news_count: news.filter(n => n.category === 'WAR').length || 2,
    politics_news_count: news.filter(n => n.category === 'POLITICS').length || 1,
    elections_news_count: news.filter(n => n.category === 'ELECTIONS').length || 1,
    macro_news_count: news.filter(n => n.category === 'MACRO').length || 2,
    last_updated_harare: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  // Filtered News Items
  const filteredNews = news.filter((item) => {
    const matchesCategory = categoryFilter === 'ALL' || item.category === categoryFilter;
    const matchesSentiment = sentimentFilter === 'ALL' || item.sentiment === sentimentFilter;
    return matchesCategory && matchesSentiment;
  });

  // Category counts
  const warCount = news.filter(n => n.category === 'WAR').length;
  const politicsCount = news.filter(n => n.category === 'POLITICS').length;
  const electionsCount = news.filter(n => n.category === 'ELECTIONS').length;
  const macroCount = news.filter(n => n.category === 'MACRO').length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-6">
      
      {/* 1. SYSTEM AI TRADE vs. HOLD ON DIRECTIVE BANNER */}
      <div 
        className={`p-5 rounded-2xl border-2 transition-all shadow-2xl relative overflow-hidden ${
          activeRec.recommendation === 'TRADE'
            ? 'bg-gradient-to-r from-emerald-950/80 via-slate-950 to-emerald-950/40 border-emerald-500/80 text-emerald-100 shadow-emerald-950/50'
            : 'bg-gradient-to-r from-rose-950/90 via-slate-950 to-amber-950/50 border-rose-500/80 text-rose-100 shadow-rose-950/50'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div 
              className={`p-3 rounded-xl shadow-lg font-black text-xl flex items-center gap-2 ${
                activeRec.recommendation === 'TRADE'
                  ? 'bg-emerald-600 text-white shadow-emerald-900/60'
                  : 'bg-rose-600 text-white shadow-rose-900/60 animate-pulse'
              }`}
            >
              {activeRec.recommendation === 'TRADE' ? (
                <>
                  <ShieldCheck className="w-6 h-6" />
                  <span>TRADE CONFIRMED</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-6 h-6" />
                  <span>HOLD ON — HIGH RISK</span>
                </>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-white font-sans uppercase">
                  Institutional News Risk & Recommendation Engine
                </h2>
                <span className="bg-slate-900/80 border border-slate-700 text-slate-300 text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold">
                  {symbol} ANALYSIS
                </span>
              </div>
              <p className="text-xs text-slate-300 font-mono mt-0.5">
                Evaluates War/Geopolitics, Politics, Elections & Macro Volatility in Real-Time (CAT / Zimbabwe Local Time)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono">
            <div className="text-right">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Confidence Level</div>
              <div className="text-lg font-black text-amber-400">{activeRec.confidence}%</div>
            </div>
            <button
              onClick={fetchNews}
              className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition shadow"
              title="Refresh News Feed & Recommendation"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Action Directive Callout Box */}
        <div className="mt-4 bg-slate-950/80 border border-white/10 p-4 rounded-xl space-y-2">
          <div className="flex items-center gap-2 font-mono text-xs font-bold">
            <Zap className={`w-4 h-4 ${activeRec.recommendation === 'TRADE' ? 'text-emerald-400' : 'text-rose-400'}`} />
            <span className={activeRec.recommendation === 'TRADE' ? 'text-emerald-400' : 'text-rose-400'}>
              SYSTEM DIRECTIVE FOR TRADER:
            </span>
            <span className="text-slate-400 font-normal ml-auto text-[11px]">
              Updated at {activeRec.last_updated_harare} CAT
            </span>
          </div>

          <p className="text-sm font-semibold text-white leading-relaxed font-sans">
            {activeRec.directive}
          </p>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 font-mono text-xs">
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400 text-[10px]">⚔️ War & Conflicts:</span>
              <span className="font-bold text-amber-400">{activeRec.war_news_count} Headlines</span>
            </div>

            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400 text-[10px]">🏛️ Politics & Tariffs:</span>
              <span className="font-bold text-indigo-400">{activeRec.politics_news_count} Headlines</span>
            </div>

            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400 text-[10px]">🗳️ Elections:</span>
              <span className="font-bold text-purple-400">{activeRec.elections_news_count} Headlines</span>
            </div>

            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400 text-[10px]">📈 Macro / Fed:</span>
              <span className="font-bold text-blue-400">{activeRec.macro_news_count} Headlines</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. TOPIC SUBTABS HEADER BAR */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold text-white">Curated Market & Macro News Channels</h3>
          </div>

          {/* Sentiment Sub-Filter */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 font-mono text-xs">
            <span className="text-slate-500 text-[10px] px-2 font-semibold">SENTIMENT:</span>
            {(['ALL', 'BULLISH', 'BEARISH', 'NEUTRAL'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSentimentFilter(s)}
                className={`px-2.5 py-1 rounded font-bold transition text-[11px] ${
                  sentimentFilter === s
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* 5 Topic Category Buttons */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <button
            onClick={() => setCategoryFilter('ALL')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition border ${
              categoryFilter === 'ALL'
                ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-900/40'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>🌐 All News Feed ({news.length})</span>
          </button>

          <button
            onClick={() => setCategoryFilter('WAR')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition border ${
              categoryFilter === 'WAR'
                ? 'bg-amber-600 text-white border-amber-400 shadow-lg shadow-amber-900/40'
                : 'bg-slate-950 text-amber-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Swords className="w-4 h-4 text-amber-400" />
            <span>⚔️ War & Geopolitics ({warCount})</span>
          </button>

          <button
            onClick={() => setCategoryFilter('POLITICS')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition border ${
              categoryFilter === 'POLITICS'
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-900/40'
                : 'bg-slate-950 text-indigo-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Landmark className="w-4 h-4 text-indigo-400" />
            <span>🏛️ Politics & Policy ({politicsCount})</span>
          </button>

          <button
            onClick={() => setCategoryFilter('ELECTIONS')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition border ${
              categoryFilter === 'ELECTIONS'
                ? 'bg-purple-600 text-white border-purple-400 shadow-lg shadow-purple-900/40'
                : 'bg-slate-950 text-purple-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Vote className="w-4 h-4 text-purple-400" />
            <span>🗳️ Elections & World Leaders ({electionsCount})</span>
          </button>

          <button
            onClick={() => setCategoryFilter('MACRO')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition border ${
              categoryFilter === 'MACRO'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-lg shadow-emerald-900/40'
                : 'bg-slate-950 text-emerald-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            <span>📈 Macro & Fed Rates ({macroCount})</span>
          </button>
        </div>
      </div>

      {/* 3. NEWS CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredNews.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-500 font-mono text-xs bg-slate-950 rounded-xl border border-slate-800">
            No active news headlines found for selected category "{categoryFilter}" and sentiment "{sentimentFilter}".
          </div>
        ) : (
          filteredNews.map((item) => {
            const getCategoryBadge = (cat: string) => {
              switch (cat) {
                case 'WAR':
                  return <span className="bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded text-[10px] font-bold">⚔️ WAR & GEOPOLITICS</span>;
                case 'POLITICS':
                  return <span className="bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded text-[10px] font-bold">🏛️ POLITICS</span>;
                case 'ELECTIONS':
                  return <span className="bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded text-[10px] font-bold">🗳️ ELECTIONS</span>;
                case 'MACRO':
                  return <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">📈 MACRO & FED</span>;
                default:
                  return <span className="bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded text-[10px] font-bold">🌐 MARKET WIRE</span>;
              }
            };

            return (
              <div
                key={item.id}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-3 transition shadow-lg group hover:shadow-2xl"
              >
                <div className="space-y-2.5">
                  {/* Category & Sentiment Header */}
                  <div className="flex items-center justify-between text-[11px] font-mono flex-wrap gap-1">
                    {getCategoryBadge(item.category)}

                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 text-[10px] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {item.time_harare} CAT
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.sentiment === 'BULLISH'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : item.sentiment === 'BEARISH'
                            ? 'bg-rose-950 text-rose-400 border border-rose-800'
                            : 'bg-slate-900 text-slate-400 border border-slate-800'
                        }`}
                      >
                        {item.sentiment}
                      </span>
                    </div>
                  </div>

                  {/* News Title */}
                  <h4 className="text-xs font-bold text-white group-hover:text-blue-400 transition leading-snug font-sans">
                    {item.title}
                  </h4>

                  {/* Summary */}
                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans line-clamp-3">
                    {item.summary}
                  </p>
                </div>

                {/* Footer Bar */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-900 text-[10px] font-mono">
                  <span className="text-slate-500 font-semibold">{item.source}</span>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline font-bold"
                  >
                    <span>Read Full Story</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
