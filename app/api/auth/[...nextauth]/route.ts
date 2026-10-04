import NextAuth, { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { getDb, ensureIndexes } from '@/lib/db/mongo';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: 'jwt' },
  cookies: {
    sessionToken: {
      name: `__Secure-next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async signIn({ user }) {
      // Upsert user in MongoDB
      const db = await getDb();
      await ensureIndexes();
      const now = new Date();
      await db.collection('users').updateOne(
        { googleId: user.id },
        {
          $set: { email: user.email, name: user.name, avatar: user.image, updatedAt: now },
          $setOnInsert: { googleId: user.id, createdAt: now },
        },
        { upsert: true }
      );
      return true;
    },
    async jwt({ token, user }) {
      if (user) token.googleId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { googleId?: string }).googleId = token.googleId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/notes',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
