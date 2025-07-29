// file: src/components/add-application-form.tsx
'use client';

import { createApplication } from '@/actions/application-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFormStatus } from 'react-dom';
import { useRef } from 'react';

function SubmitButton({ text, pendingText }: { text: string, pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingText : text}
    </Button>
  );
}

export function AddApplicationForm() {
  const formRef = useRef<HTMLFormElement>(null);

  const handleAction = async (formData: FormData) => {
    await createApplication(formData);
    formRef.current?.reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Добавить новое приложение</CardTitle>
        <CardDescription>Заполните обязательные поля (*) и любую другую информацию.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleAction} className="space-y-6">
          {/* Общие поля */}
          <div className="space-y-2">
            <label htmlFor="slug">Уникальный идентификатор (slug) *</label>
            <Input id="slug" name="slug" required placeholder="например, capitalsapp" />
          </div>
          <div className="space-y-2">
            <label htmlFor="icon">Иконка приложения (файл) *</label>
            <Input id="icon" name="icon" type="file" required accept="image/png, image/jpeg, image/webp" />
          </div>
          
          <hr/>

          {/* Поля для English */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">English</h3>
            <Input name="title_en" placeholder="Title" />
            <Input name="shortDescription_en" placeholder="Short Description (max 90 chars)" maxLength={90} />
            <Textarea name="description_en" placeholder="Description" />
          </div>

          <hr/>

          {/* Поля для Español */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Español</h3>
            <Input name="title_es" placeholder="Título" />
            <Input name="shortDescription_es" placeholder="Descripción corta (max 90)" maxLength={90} />
            <Textarea name="description_es" placeholder="Descripción" />
          </div>

          <hr/>

          {/* Поля для Русский */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Русский</h3>
            <Input name="title_ru" placeholder="Название" />
            <Input name="shortDescription_ru" placeholder="Короткое описание (макс 90)" maxLength={90} />
            <Textarea name="description_ru" placeholder="Описание" />
          </div>

          <hr/>

          {/* Ссылки */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input name="appStoreUrl" placeholder="App Store URL" />
            <Input name="googlePlayUrl" placeholder="Google Play URL" />
            <Input name="githubUrl" placeholder="GitHub URL" />
          </div>

          {/* Политика конфиденциальности */}
          <div className="space-y-2">
            <label htmlFor="privacyPolicy_en">Политика конфиденциальности (на английском)</label>
            <Textarea id="privacyPolicy_en" name="privacyPolicy_en" rows={10} />
          </div>

          <SubmitButton text="Добавить приложение" pendingText="Добавление..." />
        </form>
      </CardContent>
    </Card>
  );
}
