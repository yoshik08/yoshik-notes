import type { Metadata } from 'next';
import { Library } from '@/components/library/library';

export const metadata: Metadata = { title: 'Recently deleted' };

export default function TrashPage() {
  return <Library mode="trash" />;
}
