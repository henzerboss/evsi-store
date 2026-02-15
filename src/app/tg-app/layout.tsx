import Script from "next/script";
import "../globals.css"; // <--- ВАЖНО: Убедитесь, что путь к вашему CSS файлу верный. Обычно это globals.css в папке app

export default function TgLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body className="bg-gray-50 text-gray-900 font-sans antialiased">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}