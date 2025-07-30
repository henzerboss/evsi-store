// file: src/actions/application-actions.ts
'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth'; // <-- ИЗМЕНИТЕ ПУТЬ
import fs from 'node:fs/promises';
import path from 'node:path';
import { redirect } from 'next/navigation';
import type { Prisma } from '@prisma/client';

function getStringOrNull(value: FormDataEntryValue | null): string | null {
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    return null;
}

export async function createApplication(formData: FormData) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');

  const iconFile = formData.get('icon') as File;
  if (!iconFile || iconFile.size === 0) throw new Error('Файл иконки обязателен');

  const buffer = Buffer.from(await iconFile.arrayBuffer());
  const filename = `${Date.now()}-${iconFile.name.replace(/\s/g, '_')}`;
  const storagePath = path.join(process.cwd(), 'public/uploads', filename);
  await fs.writeFile(storagePath, buffer);
  const iconUrl = `/uploads/${filename}`;

  const dataToCreate: Prisma.ApplicationCreateInput = {
    slug: formData.get('slug') as string,
    iconUrl: iconUrl,
    title_en: getStringOrNull(formData.get('title_en')),
    description_en: getStringOrNull(formData.get('description_en')),
    shortDescription_en: getStringOrNull(formData.get('shortDescription_en')),
    title_es: getStringOrNull(formData.get('title_es')),
    description_es: getStringOrNull(formData.get('description_es')),
    shortDescription_es: getStringOrNull(formData.get('shortDescription_es')),
    title_ru: getStringOrNull(formData.get('title_ru')),
    description_ru: getStringOrNull(formData.get('description_ru')),
    shortDescription_ru: getStringOrNull(formData.get('shortDescription_ru')),
    privacyPolicy_en: getStringOrNull(formData.get('privacyPolicy_en')),
    appStoreUrl: getStringOrNull(formData.get('appStoreUrl')),
    googlePlayUrl: getStringOrNull(formData.get('googlePlayUrl')),
    githubUrl: getStringOrNull(formData.get('githubUrl')),
  };

  await prisma.application.create({ data: dataToCreate });

  revalidatePath('/');
  revalidatePath('/admin');
}

export async function updateApplication(id: string, formData: FormData) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');

  const iconFile = formData.get('icon') as File;
  let newIconUrl: string | undefined = undefined;

  if (iconFile && iconFile.size > 0) {
    const oldApp = await prisma.application.findUnique({ where: { id } });
    if (oldApp && oldApp.iconUrl) {
      try {
        await fs.unlink(path.join(process.cwd(), 'public', oldApp.iconUrl));
      } catch (error) { console.error("Не удалось удалить старый файл иконки:", error); }
    }
    const buffer = Buffer.from(await iconFile.arrayBuffer());
    const filename = `${Date.now()}-${iconFile.name.replace(/\s/g, '_')}`;
    const storagePath = path.join(process.cwd(), 'public/uploads', filename);
    await fs.writeFile(storagePath, buffer);
    newIconUrl = `/uploads/${filename}`;
  }

  const dataToUpdate: Prisma.ApplicationUpdateInput = {
    slug: formData.get('slug') as string,
    title_en: getStringOrNull(formData.get('title_en')),
    description_en: getStringOrNull(formData.get('description_en')),
    shortDescription_en: getStringOrNull(formData.get('shortDescription_en')),
    title_es: getStringOrNull(formData.get('title_es')),
    description_es: getStringOrNull(formData.get('description_es')),
    shortDescription_es: getStringOrNull(formData.get('shortDescription_es')),
    title_ru: getStringOrNull(formData.get('title_ru')),
    description_ru: getStringOrNull(formData.get('description_ru')),
    shortDescription_ru: getStringOrNull(formData.get('shortDescription_ru')),
    privacyPolicy_en: getStringOrNull(formData.get('privacyPolicy_en')),
    appStoreUrl: getStringOrNull(formData.get('appStoreUrl')),
    googlePlayUrl: getStringOrNull(formData.get('googlePlayUrl')),
    githubUrl: getStringOrNull(formData.get('githubUrl')),
  };

  if (newIconUrl) {
    dataToUpdate.iconUrl = newIconUrl;
  }

  await prisma.application.update({ where: { id }, data: dataToUpdate });

  revalidatePath('/');
  revalidatePath('/admin');
  redirect('/admin');
}

export async function deleteApplication(id: string) {
    const session = await auth();
    if (!session) throw new Error('Unauthorized');
    const app = await prisma.application.findUnique({ where: { id } });
    if (app && app.iconUrl) {
      const filePath = path.join(process.cwd(), 'public', app.iconUrl);
      try {
        await fs.unlink(filePath);
      } catch (error) { console.error("Не удалось удалить файл иконки:", error); }
    }
    await prisma.application.delete({ where: { id } });
    revalidatePath('/');
    revalidatePath('/admin');
}