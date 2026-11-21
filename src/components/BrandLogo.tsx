import React from 'react';

interface BrandLogoProps {
  logoDataUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  logoDataUrl,
  size = 'md',
  className = '',
}) => {
  const dim =
    size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-20 w-20' : 'h-12 w-12';

  if (logoDataUrl) {
    return (
      <div
        className={`${dim} shrink-0 overflow-hidden rounded-xl border border-[#C9A227]/40 bg-white flex items-center justify-center ${className}`}
      >
        <img
          src={logoDataUrl}
          alt="شعار الشركة"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={`${dim} shrink-0 ${className}`}
      aria-label="شعار نُخبة البن للتوزيع"
    >
      <defs>
        <linearGradient id="logoNavy" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#112D52" />
          <stop offset="100%" stopColor="#071529" />
        </linearGradient>
        <linearGradient id="logoGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E6C35C" />
          <stop offset="50%" stopColor="#C9A227" />
          <stop offset="100%" stopColor="#9E7B14" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#logoNavy)" />
      <circle cx="256" cy="256" r="212" fill="none" stroke="url(#logoGold)" strokeWidth="7" opacity="0.88" />
      <path d="M214 152 C202 126, 224 106, 214 82" fill="none" stroke="url(#logoGold)" strokeWidth="12" strokeLinecap="round" />
      <path d="M256 142 C242 110, 270 88, 256 60" fill="none" stroke="url(#logoGold)" strokeWidth="14" strokeLinecap="round" />
      <path d="M298 152 C286 126, 308 106, 298 82" fill="none" stroke="url(#logoGold)" strokeWidth="12" strokeLinecap="round" />
      <path d="M148 196 H352 V284 C352 342, 308 378, 250 378 C192 378, 148 342, 148 284 Z" fill="#FFFFFF" />
      <path d="M350 218 H378 C406 218, 422 238, 422 264 C422 290, 404 308, 376 308 H346" fill="none" stroke="#FFFFFF" strokeWidth="22" strokeLinecap="round" />
      <rect x="140" y="186" width="220" height="16" rx="8" fill="url(#logoGold)" />
      <g transform="translate(250, 286) rotate(-22)">
        <ellipse cx="0" cy="0" rx="34" ry="46" fill="#0B1F3A" />
        <path d="M-2 -42 C14 -16, -14 16, 2 42" fill="none" stroke="url(#logoGold)" strokeWidth="7" strokeLinecap="round" />
      </g>
      <path d="M118 394 H382 C372 416, 344 426, 250 426 C156 426, 128 416, 118 394 Z" fill="url(#logoGold)" />
    </svg>
  );
};
