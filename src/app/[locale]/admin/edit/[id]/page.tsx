// file: src/app/[locale]/admin/edit/[id]/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { EditApplicationForm } from "@/components/edit-application-form";

// Обновляем интерфейс пропсов
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

    // Ожидаем params перед использованием
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
