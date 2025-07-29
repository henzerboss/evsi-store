// file: src/components/login-form.tsx
'use client';

import { authenticate } from '@/actions/auth-actions'; // Мы создадим этот action сейчас
import { useFormState, useFormStatus } from 'react-dom';

export function LoginForm() {
  const [errorMessage, dispatch] = useFormState(authenticate, undefined);

  return (
    <form action={dispatch} className="space-y-4">
      <div className="flex flex-col space-y-2">
        <label htmlFor="username">Username</label>
        <input id="username" name="username" type="text" required className="px-3 py-2 border rounded-md bg-transparent"/>
      </div>
      <div className="flex flex-col space-y-2">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required className="px-3 py-2 border rounded-md bg-transparent"/>
      </div>
      <LoginButton />
      {errorMessage && (
        <p className="text-sm text-red-500">{errorMessage}</p>
      )}
    </form>
  );
}

function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-disabled={pending} className="w-full px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-500 disabled:bg-gray-400">
      Log in
    </button>
  );
}