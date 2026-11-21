import {Download, Share, X} from 'lucide-react';
import React, {useState} from 'react';
import {usePWAInstall} from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="min-h-[40px] flex items-center gap-2 rounded-xl bg-[#C9A227] px-3 py-2 text-xs font-bold text-[#0B1F3A] hover:bg-[#DBBA4B] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-4 h-4" />
        <span>تثبيت التطبيق</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[40px] flex items-center gap-1.5 rounded-xl border border-[#C9A227]/60 px-3 py-1.5 text-xs font-semibold text-[#DBBA4B] hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share className="w-3.5 h-3.5" />
          <span>تثبيت</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-slate-900 shadow-2xl border border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-[#0B1F3A]">تثبيت على آيفون وآيباد</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-slate-700 list-decimal list-inside">
                <li>اضغط على زر <strong>المشاركة (Share)</strong> في شريط Safari.</li>
                <li>مرر للأسفل واختر <strong>إضافة إلى الشاشة الرئيسية</strong>.</li>
                <li>اضغط <strong>إضافة</strong> لتشغيل التطبيق بدون إنترنت.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] transition-colors"
              >
                فهمت
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
