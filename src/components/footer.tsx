// file: src/components/footer.tsx
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function Footer() {
  const t = await getTranslations("Footer");
  const year = new Date().getFullYear();

  return (
    <footer className="bg-muted/40">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 sm:px-6 md:h-20 md:flex-row md:py-0 lg:px-8">
        <p className="text-center text-sm text-muted-foreground md:text-left">
          {t("copyright", { year })}
        </p>
        <Link href="/privacy" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          {t("privacy")}
        </Link>
      </div>
    </footer>
  );
}