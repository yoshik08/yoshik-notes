import { cn } from '@/lib/utils';

/** "notes", set wide in Archivo: the name as it would print on a film box. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn('font-display select-none leading-none text-white', className)}
      style={{ fontStretch: '125%', fontWeight: 720, letterSpacing: '-0.035em' }}
    >
      notes
    </span>
  );
}
