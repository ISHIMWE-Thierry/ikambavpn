import { motion } from 'framer-motion';
import { Crown } from 'lucide-react';

/**
 * Animated premium badge — shown next to a user's profile avatar
 * when they have an active paid VPN subscription.
 *
 * Black & white design for a sleek, premium look.
 *
 * Sizes:
 * - 'sm'  → 18×18 icon badge (used inline next to avatars)
 * - 'md'  → 22×22 (default)
 * - 'lg'  → pill badge with "Premium" label
 */
export function PremiumBadge({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  if (size === 'lg') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.3 }}
        className="inline-flex items-center gap-1 bg-black
          text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5
          rounded-full shadow-sm"
      >
        <Crown className="w-3 h-3" />
        Premium
      </motion.div>
    );
  }

  const sizeClass = size === 'sm' ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]';
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.4 }}
      className={`${sizeClass} bg-black
        rounded-full flex items-center justify-center shadow-sm
        ring-2 ring-white`}
      title="Premium subscriber"
    >
      <Crown className={`${iconSize} text-white`} />
    </motion.div>
  );
}
