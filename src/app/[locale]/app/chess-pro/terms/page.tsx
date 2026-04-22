// src/app/[locale]/app/chess-pro/terms/page.tsx

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Chess Pro Terms of Use',
  description: 'Terms of Use for Chess Pro Premium subscription.',
};

export default function ChessProTermsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-slate-900">
      <h1 className="text-3xl font-bold">Chess Pro Terms of Use</h1>
      <p className="mt-4 leading-7">
        These Terms of Use govern your use of the Chess Pro mobile application and the Chess Pro
        Premium auto-renewable subscription provided by evsi.store.
      </p>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">1. Subscription</h2>
        <p className="leading-7">
          Chess Pro Premium is an auto-renewable subscription that removes advertising inside the
          app while your subscription is active.
        </p>
        <p className="leading-7">
          Current subscription: <strong>Premium — €0.99 per month</strong>.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">2. Billing and renewal</h2>
        <p className="leading-7">
          Payment will be charged to your Apple App Store or Google Play account at confirmation of
          purchase.
        </p>
        <p className="leading-7">
          The subscription renews automatically every month unless auto-renew is turned off at least
          24 hours before the end of the current billing period.
        </p>
        <p className="leading-7">
          Your account will be charged for renewal within 24 hours before the end of the current
          period at the price of the selected subscription, unless changed in the store.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">3. Managing or cancelling a subscription</h2>
        <p className="leading-7">
          You can manage and cancel your subscription at any time in your App Store or Google Play
          account settings after purchase.
        </p>
        <p className="leading-7">
          If you cancel, your Premium access will remain active until the end of the paid billing
          period.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">4. Free trials and promotional offers</h2>
        <p className="leading-7">
          If a free trial or promotional price is offered in the future, any unused portion will be
          forfeited when you purchase a subscription where applicable.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">5. Refunds</h2>
        <p className="leading-7">
          Refunds are handled by Apple or Google under their respective billing policies. evsi.store
          does not directly process store subscription refunds.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">6. Privacy</h2>
        <p className="leading-7">
          Your use of the app is also subject to the Privacy Policy:{' '}
          <Link className="underline" href="/en/app/chess-pro/privacy">
            /en/app/chess-pro/privacy
          </Link>
          .
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">7. Changes to these terms</h2>
        <p className="leading-7">
          We may update these Terms of Use from time to time. Continued use of the app after any
          update means you accept the revised terms.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-2xl font-semibold">8. Contact</h2>
        <p className="leading-7">
          If you have questions about these Terms of Use, contact us at{' '}
          <a className="underline" href="mailto:support@evsi.store">
            support@evsi.store
          </a>
          .
        </p>
      </section>
    </main>
  );
}
