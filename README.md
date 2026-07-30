This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## QuitNic AI: Quit Vaping

The production API route for the mobile app is:

```text
POST /api/gemini/quit-vape-coach
```

Configure `GEMINI_API_KEY_QUITVAPE` in production. For backwards-compatible
deployments the route falls back to `GEMINI_API_KEY_QUITSMOKE`, then
`GEMINI_API_KEY`. If `SERVER_CLIENT_TOKEN` is configured, it must match the
mobile app's `X-Client-Token` header.

The legal routes are available at
`/{locale}/app/quitvape/privacy` and `/{locale}/app/quitvape/terms`.
The RevenueCat webhook recognises the `quitvape` project key and supports the
project-specific variables `REVENUECAT_WEBHOOK_AUTH_QUITVAPE`,
`REVENUECAT_WEBHOOK_HMAC_SECRET_QUITVAPE`, and
`TELEGRAM_CHAT_ID_RC_QUITVAPE`.

Before deploying a database-backed build:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
```

## Shared lifetime Premium promo codes

Mobile apps can validate a promo code with:

```text
POST /api/promocodes/validate
Content-Type: application/json

{"code":"FRIENDS2026"}
```

Configure the accepted codes as a comma-separated server environment variable:

```text
PREMIUM_PROMO_CODES=FRIENDS2026,PARTNER2026
```

The comparison is case-insensitive. The route does not write promo codes or
activations to the database. A successful response returns the generic
`premium` entitlement with `lifetime: true`, so the same route can be reused by
multiple applications.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
