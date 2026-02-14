// file: src/app/tg-app/layout.tsx

import Script from "next/script";

export default function TgLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
        {children}
      </div>
    </>
  );
}