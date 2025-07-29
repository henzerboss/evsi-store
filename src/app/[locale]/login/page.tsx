// file: src/app/[locale]/login/page.tsx
import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="mx-auto grid w-[350px] gap-6">
        <div className="grid gap-2 text-center">
          <h1 className="text-3xl font-bold">Login</h1>
          <p className="text-balance text-muted-foreground">
            Enter your credentials to access the admin panel
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}