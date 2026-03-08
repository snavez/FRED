
import React from 'react';
import { Activity } from 'lucide-react';

interface HeaderProps {
  tokenCount: number;
  isLoading: boolean;
}

const Header: React.FC<HeaderProps> = () => {
  return (
    <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center shrink-0">
      <div className="flex items-center space-x-3">
        <div className="bg-slate-700 p-1.5 rounded-lg text-white">
          <Activity size={18} />
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900 leading-tight">FRED</h1>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Formant Research for Education</p>
        </div>
      </div>
    </header>
  );
};

export default Header;
