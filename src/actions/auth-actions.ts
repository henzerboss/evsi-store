'use server';

import { signIn, signOut } from '@/auth';

// Создаем интерфейс для ошибки, чтобы TypeScript знал о полях type и code
interface AuthError extends Error {
  type?: string;
  code?: string;
  digest?: string; // Поле digest используется для определения редиректов Next.js
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    // Попытка входа с указанием редиректа
    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirectTo: '/admin', // Перенаправление в админку при успехе
    });
  } catch (error) {
    const err = error as AuthError;

    // 1. Проверяем, является ли ошибка редиректом Next.js.
    // Ошибки редиректа нельзя "глотать", их нужно выбрасывать дальше.
    if (err.message === 'NEXT_REDIRECT' || err.digest?.startsWith('NEXT_REDIRECT')) {
        throw error;
    }

    // 2. Обрабатываем ошибки авторизации, используя наш интерфейс вместо any
    if (err.type === 'CredentialsSignin' || err.code === 'credentials') {
      return 'Invalid credentials.';
    }
    
    if (err.type === 'CallbackRouteError') {
        return 'Could not login. Please try again.';
    }

    // Fallback для других типов AuthError
    if (err.name === 'AuthError') {
        switch (err.type) {
          case 'CredentialsSignin':
            return 'Invalid credentials.';
          default:
            return 'Something went wrong.';
        }
    }
    
    // Если это какая-то другая ошибка, выбрасываем её
    throw error;
  }
}

export async function signOutAction() {
    await signOut({ redirectTo: '/' }); 
}