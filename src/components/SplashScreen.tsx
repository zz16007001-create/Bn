import React from 'react';
import {BrandLogo} from './BrandLogo';

interface SplashScreenProps {
  companyName?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({companyName = 'نُخبة البن للتوزيع'}) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B1F3A] text-white px-6">
      <div className="flex flex-col items-center text-center max-w-xs">
        <div className="rounded-3xl p-2 border border-[#C9A227]/35 bg-[#071529] shadow-2xl">
          <BrandLogo size="lg" />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-white">{companyName}</h1>
        <p className="mt-2 text-sm text-[#DBBA4B]">
          إدارة توزيع البن والمنتجات الغذائية
        </p>
        <div className="mt-8 w-40 h-1 rounded-full bg-white/15 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-[#C9A227] animate-[pulse_1.1s_ease-in-out_infinite]" />
        </div>
        <p className="mt-3 text-xs text-slate-300">جارٍ تهيئة قاعدة البيانات المحلية...</p>
      </div>
    </div>
  );
};
