// file: src/app/[locale]/admin/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const session = await auth();

  // Если сессии нет, мы не будем перенаправлять, а покажем, что внутри объекта session.
  if (!session) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
        <h1>Access Denied (Debug Mode)</h1>
        <p>This page is for debugging. The redirect was stopped to show the session object.</p>
        <p>The `session` object is:</p>
        <pre>{JSON.stringify(session, null, 2)}</pre>
      </div>
    );
  }

  // Если сессия есть, покажем ее содержимое
  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
        <h1>Access Granted (Debug Mode)</h1>
        <p>The `session` object is:</p>
        <pre>{JSON.stringify(session, null, 2)}</pre>
    </div>
  );
}