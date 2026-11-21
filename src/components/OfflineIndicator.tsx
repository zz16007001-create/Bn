import {WifiOff} from 'lucide-react';
import React from 'react';
import {useOnlineStatus} from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed bottom-20 lg:bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl bg-[#0B1F3A] border border-[#C9A227]/60 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="w-4 h-4 text-[#C9A227]" />
      <span>وضع عدم الاتصال — جميع البيانات محفوظة محلياً</span>
    </div>
  );
};
