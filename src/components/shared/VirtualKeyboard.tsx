import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Delete, X, Trash2, Globe } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface VirtualKeyboardProps {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}

export function VirtualKeyboard({ value, onChange, onClose }: VirtualKeyboardProps) {
  const { language: appLanguage } = useLanguage();
  const [layout, setLayout] = useState<'fr' | 'ar'>('fr');

  // Initialize layout based on current app language
  useEffect(() => {
    if (appLanguage === 'ar') {
      setLayout('ar');
    } else {
      setLayout('fr');
    }
  }, [appLanguage]);

  const toggleLayout = () => {
    setLayout((prev) => (prev === 'fr' ? 'ar' : 'fr'));
  };

  const handleKeyClick = (key: string) => {
    if (key === 'BACKSPACE') {
      onChange(value.slice(0, -1));
    } else if (key === 'CLEAR') {
      onChange('');
    } else if (key === 'SPACE') {
      onChange(value + ' ');
    } else {
      onChange(value + key);
    }
  };

  const frRows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
    ['W', 'X', 'C', 'V', 'B', 'N', '\'', '-', ',', '.'],
  ];

  const arRows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج', 'د'],
    ['ش', 'س', 'ي', 'ب', 'ل', 'ت', 'ن', 'م', 'ك', 'ط', 'ذ'],
    ['ئ', 'ء', 'ؤ', 'ر', 'لا', 'ى', 'ة', 'و', 'ز', 'ظ'],
  ];

  const activeRows = layout === 'fr' ? frRows : arRows;
  const isRTL = layout === 'ar';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="w-full bg-[--surface-dropdown]/95 backdrop-blur border border-gold/25 shadow-hover rounded-2xl p-4 mt-3"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Keyboard Header */}
      <div className="flex items-center justify-between mb-3 border-b border-gold/10 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            {layout === 'fr' ? 'Clavier Virtuel (AZERTY)' : 'لوحة المفاتيح الافتراضية'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Language Toggle */}
          <button
            type="button"
            onClick={toggleLayout}
            onMouseDown={(e) => e.preventDefault()} // Keep focus on input
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-lavender/10 hover:bg-lavender/25 text-text-primary border border-lavender/20 transition-all active:scale-95"
          >
            <Globe size={13} />
            <span>{layout === 'fr' ? 'عربي' : 'Français'}</span>
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            onMouseDown={(e) => e.preventDefault()}
            className="p-1 rounded-lg hover:bg-rose-deep/10 text-rose-deep transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Keyboard Layout Keys */}
      <div className="space-y-2">
        {activeRows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex justify-center gap-1 sm:gap-1.5">
            {row.map((key) => (
              <button
                key={key}
                type="button"
                onMouseDown={(e) => e.preventDefault()} // Crucial: prevent input blur
                onClick={() => handleKeyClick(key)}
                className="flex-1 min-w-[28px] h-10 sm:h-12 bg-[--surface-input] hover:bg-gold/10 active:bg-gold/20 border border-gold/15 text-text-primary rounded-xl flex items-center justify-center text-sm font-semibold transition-all shadow-sm active:scale-95"
              >
                {key}
              </button>
            ))}
          </div>
        ))}

        {/* Bottom row (Controls: Clear, Space, Backspace) */}
        <div className="flex justify-center gap-1.5 pt-1">
          {/* Clear Key */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleKeyClick('CLEAR')}
            className="px-3 h-11 bg-rose-deep/10 hover:bg-rose-deep/20 active:bg-rose-deep/30 border border-rose-deep/20 text-rose-deep rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-all active:scale-95"
          >
            <Trash2 size={14} />
            <span>{layout === 'fr' ? 'Vider' : 'مسح'}</span>
          </button>

          {/* Space Key */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleKeyClick('SPACE')}
            className="flex-[2] h-11 bg-[--surface-input] hover:bg-gold/10 active:bg-gold/20 border border-gold/15 text-text-primary rounded-xl flex items-center justify-center text-sm font-semibold transition-all shadow-sm active:scale-95"
          >
            {layout === 'fr' ? 'Espace' : 'مسافة'}
          </button>

          {/* Backspace Key */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleKeyClick('BACKSPACE')}
            className="px-3 h-11 bg-vanilla/60 hover:bg-vanilla text-text-secondary border border-gold/15 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-all active:scale-95"
          >
            <Delete size={14} />
            <span>{layout === 'fr' ? 'Effacer' : 'تراجع'}</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
