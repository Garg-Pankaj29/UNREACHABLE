import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { apiService } from '../services/api';

interface DisclaimerBannerProps {
  customText?: string;
}

export const DisclaimerBanner: React.FC<DisclaimerBannerProps> = ({ customText }) => {
  const [dataMode, setDataMode] = useState<string>('demo');

  useEffect(() => {
    let active = true;
    apiService
      .fetchHealth()
      .then((h: any) => {
        if (active && h?.data_mode) {
          setDataMode(h.data_mode.toLowerCase());
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const isReal = dataMode === 'real';

  const defaultDemoText =
    'All displayed street widths, simulated obstructions, and building accessibility states are synthetic fixtures for technical demonstration. This system is not an official municipal emergency safety certification or dispatch guarantee.';

  const bannerText = isReal
    ? 'REAL OSM DATA · WIDTHS UNVERIFIED · ADVISORY'
    : customText || defaultDemoText;

  return (
    <div
      role="alert"
      className="bg-amber-50 border-l-4 border-amber-500 p-3 text-xs text-amber-900 flex items-start space-x-2.5 rounded-r shadow-xs"
    >
      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="leading-relaxed">
        <span className="font-semibold text-amber-950">
          {isReal ? 'DATA ADVISORY: ' : 'PROTOTYPE DEMONSTRATION ONLY: '}
        </span>
        {bannerText}
      </div>
    </div>
  );
};
