// file: src/app/[locale]/admin/page.tsx
import { auth } from "@/auth"; // <-- ИЗМЕНИТЕ ПУТЬ
import { redirect } from "next/navigation";
import Link from "next/link";
import { AddApplicationForm } from "@/components/add-application-form";
import { ApplicationsList } from "@/components/applications-list";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AdminPage() {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="container max-w-5xl mx-auto py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <p className="text-muted-foreground">Welcome, {session.user?.name}!</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/chess-admin"
            className="text-sm font-bold px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 transition"
          >
            ♟️ Chess Pro Admin
          </Link>
          <SignOutButton />
        </div>
      </div>

      <div className="space-y-12">
        <AddApplicationForm />
        <ApplicationsList />
      </div>
    </div>
  );
}