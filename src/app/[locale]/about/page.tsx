// file: src/app/[locale]/about/page.tsx
import { getTranslations } from "next-intl/server";
import { getLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import Image from "next/image"; // Импортируем компонент Image

export async function generateMetadata() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'AboutPage' });
  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function AboutPage() {
  const t = await getTranslations("AboutPage");
  return (
    <div className="container max-w-4xl mx-auto py-12 md:py-20 px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 items-center">
        {/* Блок с фото */}
        <div className="md:col-span-1 flex justify-center">
          {/* ИЗМЕНЕНИЕ: Заменяем заглушку на ваше фото */}
          <Image
            src="/uploads/avatar.jpeg"
            alt={t('name')}
            width={192} // 12rem
            height={192} // 12rem
            className="rounded-full object-cover w-48 h-48"
            priority // Говорим Next.js загрузить это изображение в первую очередь
          />
        </div>

        {/* Блок с текстом */}
        <div className="md:col-span-2 space-y-4">
          <p className="text-lg text-muted-foreground">{t('greeting')}</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{t('name')}</h1>
          <h2 className="text-xl md:text-2xl font-medium text-primary">{t('role')}</h2>
          <p className="text-muted-foreground leading-relaxed">{t('p1')}</p>
          <p className="text-muted-foreground leading-relaxed">{t('p2')}</p>
        </div>
      </div>

      {/* Блок со стеком */}
      <div className="mt-16">
        <h3 className="text-2xl font-bold text-center mb-8">{t('stack_title')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div className="p-6 border rounded-lg text-center">
            <h4 className="font-semibold mb-2">{t('stack_items.mobile')}</h4>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="secondary">React Native</Badge>
              <Badge variant="secondary">Expo</Badge>
              <Badge variant="secondary">TypeScript</Badge>
            </div>
          </div>
          <div className="p-6 border rounded-lg text-center">
            <h4 className="font-semibold mb-2">{t('stack_items.frontend')}</h4>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="secondary">Next.js</Badge>
              <Badge variant="secondary">React</Badge>
              <Badge variant="secondary">Tailwind CSS</Badge>
            </div>
          </div>
          <div className="p-6 border rounded-lg text-center">
            <h4 className="font-semibold mb-2">{t('stack_items.backend')}</h4>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="secondary">Node.js</Badge>
              <Badge variant="secondary">Prisma</Badge>
              <Badge variant="secondary">PostgreSQL</Badge>
              <Badge variant="secondary">SQLite</Badge>
            </div>
          </div>
        </div>
      </div>
      
      {/* Блок с контактами */}
      <div className="mt-16 text-center">
         <p className="text-muted-foreground">{t('contact')}</p>
         <a href="mailto:support@evsi.store" className="font-medium text-primary hover:underline">
            support@evsi.store
         </a>
      </div>
    </div>
  );
}