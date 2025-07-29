// file: src/app/[locale]/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import {NextIntlClientProvider, hasLocale} from 'next-intl';
import {notFound} from 'next/navigation';
import {routing} from '@/i18n/routing';
import {getMessages} from 'next-intl/server';
import { Header } from "@/components/header"; 
import { Footer } from "@/components/footer";
import { GoogleAnalytics } from '@next/third-parties/google'; // <-- ИМПОРТ
import { CookieConsent } from '@/components/cookie-consent'; // <-- ИМПОРТ

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "evsi.store",
  description: "My applications portfolio",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({locale}));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{locale: string}>;
}

export default async function LocaleLayout({
  children,
  params
}: LocaleLayoutProps) {
  const {locale} = await params;
  
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
       <body className={`min-h-screen bg-background font-sans antialiased ${inter.className}`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <div className="relative flex min-h-screen flex-col bg-muted/25">
              <Header />
              <main className="flex-grow pt-16">{children}</main>
              <Footer />
            </div>
            <CookieConsent /> {/* <-- ДОБАВЛЯЕМ БАННЕР */}
          </ThemeProvider>
        </NextIntlClientProvider>
        <GoogleAnalytics gaId="G-XD3KHC7ME8" />
      </body>
    </html>
  );
}