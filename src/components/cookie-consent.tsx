// file: src/components/cookie-consent.tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { useTranslations } from 'next-intl';

const COOKIE_CONSENT_KEY = 'cookie_consent_accepted';

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const t = useTranslations('CookieConsent');

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (consent !== 'true') {
      setShowBanner(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'true');
    setShowBanner(false);
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm border-t">
      <div className="container mx-auto flex items-center justify-between p-4">
        <p className="text-sm text-muted-foreground">{t('message')}</p>
        <Button size="sm" onClick={handleAccept}>{t('accept')}</Button>
      </div>
    </div>
  );
}
