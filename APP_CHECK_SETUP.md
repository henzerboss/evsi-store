# Firebase App Check rollout

The application prefers Firebase App Check for protected API requests.
`EXPO_PUBLIC_CLIENT_TOKEN` remains only as a temporary Expo Go / old-client fallback.

## Android: Play Integrity

1. In Google Play Console open the app, then **App integrity**.
2. In **Play Integrity API**, link the same Google Cloud / Firebase project used by this app.
3. Copy SHA-256 from **App signing key certificate** (not the upload key) and paste it into Firebase App Check.
4. Keep token TTL at 1 hour.
5. Recommended while Play and direct test builds may coexist:
   - Require `PLAY_RECOGNIZED`: enabled
   - Require `LICENSED`: disabled
   - Minimum device integrity: do not explicitly check
6. Accept the Play Integrity API terms and save.

For a production app distributed exclusively through Google Play, `LICENSED` can be enabled later.
Development clients use the App Check debug provider and require a registered debug token.

## iOS: App Attest + DeviceCheck fallback

The app config includes this production entitlement:

```json
"com.apple.developer.devicecheck.appattest-environment": "production"
```

EAS Build synchronizes the App Attest capability with Apple when building.

### App Attest

1. Enter the 10-character Apple Team ID.
2. Keep token TTL at 1 hour.
3. Save.

### DeviceCheck fallback

1. In Apple Developer, create a private key with DeviceCheck enabled.
2. Download the `.p8` file (Apple normally allows downloading it only once).
3. Upload the `.p8` file in Firebase.
4. Enter the Apple key ID and the same Apple Team ID.
5. Keep token TTL at 1 hour and save.

## Server environment

Keep the legacy token while old app versions remain supported:

```env
SERVER_CLIENT_TOKEN=your_existing_token
FIREBASE_PROJECT_NUMBER=635540041978
FIREBASE_APP_CHECK_ALLOWED_APP_IDS=1:635540041978:android:88bc74704de7d3c7eb5943,1:635540041978:ios:f24632d21a814c78eb5943
```

The Firebase values are also present as safe defaults in the server code, but explicit environment variables are easier to audit.

## Safe rollout order

1. Deploy the updated backend first.
2. Keep `SERVER_CLIENT_TOKEN` for existing released clients.
3. Register Android and iOS providers in Firebase App Check.
4. Build a new native EAS build.
5. Test image, text, audio analysis and the weekly report.
6. Remove `EXPO_PUBLIC_CLIENT_TOKEN` from the EAS production environment before the final production build.
7. Keep `SERVER_CLIENT_TOKEN` on the backend until old released versions no longer need support.

## Expo Go and development

Expo Go has no native App Check module and therefore uses the legacy fallback. Put the legacy token only in a local ignored `.env.local` when needed.

A custom development build uses the debug App Check provider. Register its debug token in Firebase Console under the app's **Manage debug tokens** menu.
