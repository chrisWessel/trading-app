'use client';

import React, { useEffect, useState } from 'react';
import { Database, FileText, Download, TrendingUp, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

interface TradeLog {
  id: number;
  timestamp: string;
  symbol: string;
  signal_type: string;
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  take_profit: number;
  position_size_usd: number;
  outcome: string;
  pnl_usd: number;
  pnl_percentage: number;
  rationale: string;
}

interface AuditReportSectionProps {
  refreshTrigger?: number;
}

export default function AuditReportSection({ refreshTrigger = 0 }: AuditReportSectionProps) {
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);

  const fetchTradeHistory = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/trades/history`);
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades || []);
      }
    } catch (err) {
      console.error('Audit history fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTradeHistory();
  }, [refreshTrigger]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/report/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `monthly_trading_audit_${new Date().toISOString().slice(0, 7)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      console.error('PDF download error:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Performance summary math
  const totalTrades = trades.length;
  const winCount = trades.filter((t) => t.outcome === 'WIN').length;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  const totalNetPnlUsd = trades.reduce((acc, t) => acc + (t.pnl_usd || 0), 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold text-white font-sans">SQLite Trade Execution Database Audit Log</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf || totalTrades === 0}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-2 shadow-lg shadow-emerald-950 transition font-sans text-xs"
          >
            <Download className="w-4 h-4" />
            <span>{downloadingPdf ? 'Generating PDF...' : 'Download Monthly PDF Audit'}</span>
          </button>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
          <span className="text-slate-400 block text-[10px]">TOTAL EXECUTED TRADES</span>
          <span className="text-white text-base font-bold">{totalTrades} Positions</span>
        </div>
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
          <span className="text-slate-400 block text-[10px]">WIN RATE %</span>
          <span className="text-emerald-400 text-base font-bold">{winRate.toFixed(1)}% ({winCount} W)</span>
        </div>
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
          <span className="text-slate-400 block text-[10px]">TOTAL NET REALIZED PnL</span>
          <span className={`text-base font-bold ${totalNetPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${totalNetPnlUsd.toFixed(2)}
          </span>
        </div>
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-slate-400 block text-[10px]">STORAGE ENGINE</span>
            <span className="text-blue-400 text-xs font-bold">SQLite closed_signals</span>
          </div>
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
        </div>
      </div>

      {/* Database Table */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-left text-xs font-mono table-fixed">
          <thead className="bg-slate-900 text-slate-400 text-[11px] border-b border-slate-800">
            <tr>
              <th className="p-2.5 w-[5%] whitespace-nowrap">ID</th>
              <th className="p-2.5 w-[18%] whitespace-nowrap">TIMESTAMP (UK)</th>
              <th className="p-2.5 w-[10%] whitespace-nowrap">SYMBOL</th>
              <th className="p-2.5 w-[12%] whitespace-nowrap">TYPE</th>
              <th className="p-2.5 w-[12%] whitespace-nowrap text-right">ENTRY ($)</th>
              <th className="p-2.5 w-[12%] whitespace-nowrap text-right">EXIT ($)</th>
              <th className="p-2.5 w-[18%] whitespace-nowrap text-right">REALIZED PnL ($)</th>
              <th className="p-2.5 w-[13%] whitespace-nowrap text-center">OUTCOME</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-4 text-center text-slate-500 font-mono">
                  No closed paper trades logged yet in trade_signals.db database.
                </td>
              </tr>
            ) : (
              trades.slice().reverse().map((t) => {
                const isHigh = t.entry_price > 10.0;
                const prec = isHigh ? 2 : 4;
                return (
                  <tr key={t.id} className="hover:bg-slate-900/50 transition">
                    <td className="p-2.5 text-slate-400 whitespace-nowrap">#{t.id}</td>
                    <td className="p-2.5 text-slate-300 whitespace-nowrap truncate">{t.timestamp}</td>
                    <td className="p-2.5 text-white font-bold whitespace-nowrap">{t.symbol}</td>
                    <td className="p-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.signal_type?.includes('BUY')
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-rose-950 text-rose-400 border border-rose-800'
                      }`}>
                        {t.signal_type}
                      </span>
                    </td>
                    <td className="p-2.5 text-slate-200 text-right whitespace-nowrap">${t.entry_price.toFixed(prec)}</td>
                    <td className="p-2.5 text-slate-200 text-right whitespace-nowrap">${t.exit_price.toFixed(prec)}</td>
                    <td className={`p-2.5 font-bold text-right whitespace-nowrap ${t.pnl_usd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${t.pnl_usd.toFixed(2)} ({t.pnl_percentage >= 0 ? '+' : ''}{t.pnl_percentage.toFixed(2)}%)
                    </td>
                    <td className="p-2.5 text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.outcome === 'WIN' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                      }`}>
                        {t.outcome}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
