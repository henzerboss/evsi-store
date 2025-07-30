// file: src/app/[locale]/admin/edit/[id]/page.tsx
import { auth } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { EditApplicationForm } from "@/components/edit-application-form";

// ИСПРАВЛЕНИЕ: Обновляем интерфейс пропсов
interface EditPageProps {
    params: Promise<{
        id: string;
    }>
}

export default async function EditPage({ params }: EditPageProps) {
    const session = await auth();
    if (!session) {
        redirect('/login');
    }

    // ИСПРАВЛЕНИЕ: Ожидаем params перед использованием
    const { id } = await params;

    const app = await prisma.application.findUnique({
        where: { id: id }
    });

    if (!app) {
        notFound();
    }

    return (
        <div className="container max-w-5xl mx-auto py-10">
            <EditApplicationForm app={app} />
        </div>
    );
}
