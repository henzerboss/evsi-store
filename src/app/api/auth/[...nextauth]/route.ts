// file: src/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// bcrypt здесь больше не нужен для сравнения, но оставим его для будущего, если понадобится хеширование


export const { handlers, signIn, signOut, auth } = NextAuth({
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
        
        // ИСПРАВЛЕНИЕ: Прямое сравнение паролей.
        // bcrypt.compare используется для сравнения пароля с ХЕШЕМ.
        // Так как в .env у нас пароль в открытом виде, мы просто сравниваем строки.
        const isPasswordCorrect = credentials.password === adminPassword;

        if (isUsernameCorrect && isPasswordCorrect) {
          // Возвращаем объект пользователя, если все верно
          return { id: "1", name: "Admin" };
        }

        // Возвращаем null, если данные неверны
        return null;
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
});
