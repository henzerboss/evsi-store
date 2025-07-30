// file: src/components/privacy-dialog-wrapper.tsx
'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { BookText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PrivacyDialogWrapper({ slug, title, policyText, initiallyOpen }: { slug: string; title: string; policyText: string; initiallyOpen: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isModalOpen, setIsModalOpen] = useState(initiallyOpen);

  const privacyPath = `/app/${slug}/privacy`;
  const basePath = `/app/${slug}`;

  useEffect(() => {
    setIsModalOpen(pathname.endsWith(privacyPath));
  }, [pathname, privacyPath]);

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setIsModalOpen(false);
      // Если текущий путь - это путь политики, возвращаемся на базовую страницу приложения
      if (pathname.endsWith(privacyPath)) {
        router.push(basePath);
      }
    }
  };

  return (
    <>
      <Button asChild variant="secondary">
        <Link href={privacyPath}><BookText /> Privacy Policy</Link>
      </Button>

      <Dialog open={isModalOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle>Privacy Policy for {title}</DialogTitle>
            <DialogDescription>
              This policy is only available in English.
            </DialogDescription>
          </DialogHeader>
          <div className="prose dark:prose-invert max-w-none max-h-[60vh] overflow-y-auto">
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {policyText || 'No privacy policy provided.'}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}