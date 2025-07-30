// file: src/auth.ts (НОВЫЙ ФАЙЛ)
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth({
  trustHost: true, // <-- ДОБАВЬТЕ ЭТУ СТРОКУ
  providers: [
    Credentials({
      credentials: {
        username: {},
        password: {},
      },
      authorize: async (credentials) => {
        const adminUsername = process.env.ADMIN_USERNAME;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!credentials.username || !credentials.password || !adminUsername || !adminPassword) {
          return null;
        }

        const isUsernameCorrect = credentials.username === adminUsername;
        const isPasswordCorrect = credentials.password === adminPassword;

        if (isUsernameCorrect && isPasswordCorrect) {
          return { id: "1", name: "Admin" };
        }
        return null;
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
});
