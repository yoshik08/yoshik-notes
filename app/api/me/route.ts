import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ user: null }, { status: 401 });
  }
  return Response.json({
    user: {
      googleId: (session.user as { googleId?: string }).googleId,
      email: session.user.email,
      name: session.user.name,
      avatar: session.user.image,
    },
  });
}
