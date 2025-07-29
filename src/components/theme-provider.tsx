// file: components/theme-provider.tsx
"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

// Мы используем React.ComponentPropsWithoutRef для получения типа пропсов напрямую из компонента.
// Это более надежный подход, который позволяет избежать потенциальных ошибок с импортом
// типа из внутренних файлов библиотеки ('next-themes/dist/types').
export function ThemeProvider({ children, ...props }: React.ComponentPropsWithoutRef<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}