import { motion } from 'framer-motion';
import { Building2 } from 'lucide-react';
import { useSettingsStore } from '@/store/settingsStore';

interface LogoBadgeProps {
  size?: number;
  icon?: number;
  className?: string;
}

// Store logo wrapped in an animated gold & silver metallic gradient frame.
export function LogoBadge({ size = 44, icon = 24, className = '' }: LogoBadgeProps) {
  const logo = useSettingsStore((s) => s.settings.logo);

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {/* Rotating conic-gradient gold/silver frame */}
      <motion.div
        aria-hidden
        className="absolute -inset-[3px] rounded-2xl"
        style={{ background: 'conic-gradient(from 0deg, #FDE047, #EAB308, #CBD5E1, #94A3B8, #EAB308)' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
      />
      {/* Soft gold glow pulse */}
      <motion.div
        aria-hidden
        className="absolute -inset-[3px] rounded-2xl blur-md opacity-70"
        style={{ background: 'conic-gradient(from 180deg, #FDE047, #EAB308, #CBD5E1, #94A3B8, #EAB308)' }}
        animate={{ rotate: -360, opacity: [0.4, 0.8, 0.4] }}
        transition={{ rotate: { duration: 10, repeat: Infinity, ease: 'linear' }, opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }}
      />
      {/* Inner content — uses CSS variable so it adapts in light mode */}
      <div
        className="absolute inset-0 rounded-2xl flex items-center justify-center overflow-hidden border border-gold/30"
        style={{ background: 'var(--logo-inner-solid)' }}
      >
        {logo ? (
          <img src={logo} alt="logo" className="h-full w-full object-cover rounded-2xl" />
        ) : (
          <div
            className="h-full w-full flex items-center justify-center rounded-2xl"
            style={{ background: 'var(--logo-inner-bg)' }}
          >
            <Building2 size={icon} className="text-gold" />
          </div>
        )}
      </div>
    </div>
  );
}
