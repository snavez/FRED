
import React, { useState } from 'react';
import { Activity, Brain, Download, HelpCircle } from 'lucide-react';
import { getGeminiInsights } from '../services/geminiService';
import { SpeechToken } from '../types';

interface HeaderProps {
  tokenCount: number;
  isLoading: boolean;
  data: SpeechToken[];
}

const Header: React.FC<HeaderProps> = ({ tokenCount, isLoading, data }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (data.length === 0) return;
    setIsAnalyzing(true);
    try {
      const result = await getGeminiInsights(data.slice(0, 100)); // Sample for AI
      setInsight(result);
    } catch (e) {
      setInsight("Failed to generate AI insights.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center space-x-3">
        <div className="bg-indigo-600 p-2 rounded-lg text-white">
          <Activity size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">FRED</h1>
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Speech Acoustic Explorer</p>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="hidden md:flex flex-col items-end mr-4">
          <span className="text-sm font-semibold text-slate-700">{tokenCount.toLocaleString()} Tokens</span>
          <span className="text-[10px] text-slate-400">ACTIVE IN VIEWPORT</span>
        </div>

        <button 
          onClick={handleAnalyze}
          disabled={isLoading || isAnalyzing}
          className="flex items-center space-x-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-indigo-100 disabled:opacity-50"
        >
          {isAnalyzing ? (
            <div className="h-4 w-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <Brain size={16} />
          )}
          <span>{isAnalyzing ? 'Thinking...' : 'AI Insights'}</span>
        </button>

        <button className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors">
          <Download size={20} />
        </button>
        <button className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors">
          <HelpCircle size={20} />
        </button>
      </div>

      {insight && (
        <div className="fixed top-20 right-6 w-80 bg-white shadow-xl border border-indigo-100 rounded-xl p-4 z-50 animate-in slide-in-from-right-4 duration-300">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-indigo-900 flex items-center">
              <Brain size={14} className="mr-1" /> Acoustic Summary
            </h3>
            <button onClick={() => setInsight(null)} className="text-slate-400 hover:text-slate-600">×</button>
          </div>
          <div className="text-sm text-slate-600 max-h-64 overflow-y-auto leading-relaxed">
            {insight}
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
