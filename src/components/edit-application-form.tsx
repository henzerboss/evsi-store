// file: src/components/edit-application-form.tsx
'use client';

import { updateApplication } from '@/actions/application-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFormStatus } from 'react-dom';
import type { Application } from '@prisma/client';
import Image from 'next/image';

function SubmitButton({ text, pendingText }: { text: string, pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingText : text}
    </Button>
  );
}

export function EditApplicationForm({ app }: { app: Application }) {
  const updateAction = updateApplication.bind(null, app.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Редактировать: {app.title_en || app.slug}</CardTitle>
        <CardDescription>Измените необходимые поля и сохраните.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateAction} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="slug">Уникальный идентификатор (slug) *</label>
            <Input id="slug" name="slug" required defaultValue={app.slug} />
          </div>
          <div className="space-y-2">
            <label>Текущая иконка</label>
            <Image src={app.iconUrl} alt={app.title_en || 'App Icon'} width={60} height={60} className="rounded-[15px] border" />
          </div>
          <div className="space-y-2">
            <label htmlFor="icon">Загрузить новую иконку (оставьте пустым, чтобы не менять)</label>
            <Input id="icon" name="icon" type="file" accept="image/png, image/jpeg, image/webp" />
          </div>

          <hr/>

          <div className="space-y-4">
            <h3 className="text-lg font-medium">English</h3>
            <Input name="title_en" placeholder="Title" defaultValue={app.title_en ?? ''} />
            <Input name="shortDescription_en" placeholder="Short Description (max 90 chars)" maxLength={90} defaultValue={app.shortDescription_en ?? ''} />
            <Textarea name="description_en" placeholder="Description" defaultValue={app.description_en ?? ''} />
          </div>

          <hr/>

          <div className="space-y-4">
            <h3 className="text-lg font-medium">Español</h3>
            <Input name="title_es" placeholder="Título" defaultValue={app.title_es ?? ''} />
            <Input name="shortDescription_es" placeholder="Descripción corta (max 90)" maxLength={90} defaultValue={app.shortDescription_es ?? ''} />
            <Textarea name="description_es" placeholder="Descripción" defaultValue={app.description_es ?? ''} />
          </div>

          <hr/>

          <div className="space-y-4">
            <h3 className="text-lg font-medium">Русский</h3>
            <Input name="title_ru" placeholder="Название" defaultValue={app.title_ru ?? ''} />
            <Input name="shortDescription_ru" placeholder="Короткое описание (макс 90)" maxLength={90} defaultValue={app.shortDescription_ru ?? ''} />
            <Textarea name="description_ru" placeholder="Описание" defaultValue={app.description_ru ?? ''} />
          </div>

          <hr/>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input name="appStoreUrl" placeholder="App Store URL" defaultValue={app.appStoreUrl ?? ''} />
            <Input name="googlePlayUrl" placeholder="Google Play URL" defaultValue={app.googlePlayUrl ?? ''} />
            <Input name="githubUrl" placeholder="GitHub URL" defaultValue={app.githubUrl ?? ''} />
          </div>

          <div className="space-y-2">
            <label htmlFor="privacyPolicy_en">Политика конфиденциальности (на английском)</label>
            <Textarea id="privacyPolicy_en" name="privacyPolicy_en" rows={10} defaultValue={app.privacyPolicy_en ?? ''} />
          </div>

          <SubmitButton text="Сохранить изменения" pendingText="Сохранение..." />
        </form>
      </CardContent>
    </Card>
  );
}