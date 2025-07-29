// file: src/components/locale-switcher.tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobeIcon } from "@radix-ui/react-icons";
import { useLocale, useTranslations } from "next-intl";
// ИЗМЕНЕНИЕ: Правильный путь к навигации
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTransition } from "react";

// ... остальной код компонента без изменений
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const handleLocaleChange = (nextLocale: string) => {
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" disabled={isPending}>
          <GlobeIcon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("label")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={locale === "en"} onClick={() => handleLocaleChange("en")}>{t("en")}</DropdownMenuItem>
        <DropdownMenuItem disabled={locale === "es"} onClick={() => handleLocaleChange("es")}>{t("es")}</DropdownMenuItem>
        <DropdownMenuItem disabled={locale === "ru"} onClick={() => handleLocaleChange("ru")}>{t("ru")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}