// file: src/components/applications-list.tsx
import prisma from '@/lib/prisma';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteApplication } from '@/actions/application-actions';
import { Button } from './ui/button';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';

function DeleteButton({ id }: { id: string }) {
  const deleteAction = deleteApplication.bind(null, id);
  return (
    <form action={deleteAction}>
      <Button variant="destructive" size="sm" type="submit">Удалить</Button>
    </form>
  );
}

export async function ApplicationsList() {
  const applications = await prisma.application.findMany({
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (applications.length === 0) {
    return <p className="mt-8 text-center text-muted-foreground">Приложений пока нет.</p>;
  }

  return (
    <div className="mt-8 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Иконка</TableHead>
            <TableHead>Название (EN)</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Дата создания</TableHead>
            <TableHead className="text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.map((app) => (
            <TableRow key={app.id}>
              <TableCell>
                <Image 
                  src={app.iconUrl} 
                  alt={app.title_en || 'Application Icon'}
                  width={40} 
                  height={40} 
                  className="rounded-[10px] object-cover"
                />
              </TableCell>
              <TableCell className="font-medium">{app.title_en || '(No Title)'}</TableCell>
              <TableCell>{app.slug}</TableCell>
              <TableCell>{app.createdAt.toLocaleDateString()}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/admin/edit/${app.id}`}>
                    <Button variant="outline" size="sm">Редактировать</Button>
                  </Link>
                  <DeleteButton id={app.id} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
