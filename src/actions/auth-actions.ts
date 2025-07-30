// file: src/actions/auth-actions.ts
'use server';


import { signIn, signOut } from '@/auth'; // <-- ИЗМЕНИТЕ ПУТЬ
import { AuthError } from 'next-auth';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    // ИСПРАВЛЕНИЕ: Передаем объект с данными и redirectTo
    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirectTo: '/admin', // Явно указываем, куда перенаправить после успеха
    });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    // ВАЖНО: NextAuth при успешном входе с редиректом выбрасывает специальную ошибку.
    // Ее нужно "пробросить" дальше, чтобы Next.js выполнил перенаправление.
    throw error;
  }
}

export async function signOutAction() {
    await signOut({ redirectTo: '/' }); 
}