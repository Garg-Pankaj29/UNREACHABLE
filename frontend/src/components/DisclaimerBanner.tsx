import React from 'react';
import { AlertCircle } from 'lucide-react';

interface DisclaimerBannerProps {
  customText?: string;
}

export const DisclaimerBanner: React.FC<DisclaimerBannerProps> = ({ customText }) => {
  return (
    <div
      role="alert"
      className="bg-amber-50 border-l-4 border-amber-500 p-3 text-xs text-amber-900 flex items-start space-x-2.5 rounded-r shadow-xs"
    >
      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="leading-relaxed">
        <span className="font-semibold text-amber-950">PROTOTYPE DEMONSTRATION ONLY: </span>
        {customText ||
          'All displayed street widths, simulated obstructions, and building accessibility states are synthetic fixtures for technical demonstration. This system is not an official municipal emergency safety certification or dispatch guarantee.'}
      </div>
    </div>
  );
};
