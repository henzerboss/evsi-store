# Calorie Counter API authentication migration

The protected Calorie Counter routes accept either:

- Firebase App Check (`X-Firebase-AppCheck`) from new native builds; or
- the existing `X-Client-Token` from already released builds.

## Required environment variables

Keep the existing value:

```env
SERVER_CLIENT_TOKEN=existing_legacy_token
```

Optional overrides (defaults already match the current Firebase project):

```env
FIREBASE_PROJECT_NUMBER=635540041978
FIREBASE_APP_CHECK_ALLOWED_APP_IDS=1:635540041978:android:88bc74704de7d3c7eb5943,1:635540041978:ios:f24632d21a814c78eb5943
```

## Deployment order

1. Deploy this backend while retaining `SERVER_CLIENT_TOKEN`.
2. Enable Play Integrity and App Attest / DeviceCheck in Firebase App Check.
3. Release the new native app build.
4. Do not remove `SERVER_CLIENT_TOKEN` until old app versions no longer need support.

No Firebase Admin private key is required. The server verifies App Check JWT signatures against Firebase's public JWKS and checks issuer, audience, expiration and app ID.
