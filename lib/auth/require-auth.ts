import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function requireAuth(): Promise<string> {
  const session = await getServerSession(authOptions);
  const googleId = (session?.user as { googleId?: string } | undefined)?.googleId;
  if (!googleId) throw new Error('Unauthorized');
  return googleId;
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
