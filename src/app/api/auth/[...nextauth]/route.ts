// file: src/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

// ИСПРАВЛЕНИЕ: Мы деструктурируем handlers на GET и POST и экспортируем их отдельно.
const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth({
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

export { GET, POST }; // <-- Экспортируем GET и POST
export { auth, signIn, signOut }; // <-- Экспортируем остальные утилиты