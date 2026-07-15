# CalorieCounterAI API authentication

The CalorieCounterAI Gemini endpoints use `X-Client-Token`.

## Current compatible setup

Keep the existing token on the server:

```env
SERVER_CLIENT_TOKEN=your_current_token
```

Already released app versions will continue to work without any changes.

## Optional dedicated token and gradual rotation

To stop sharing one token with other projects, add a dedicated token:

```env
CALORIE_COUNTER_CLIENT_TOKEN=new_long_random_token
```

New app builds can use `EXPO_PUBLIC_CALORIE_COUNTER_CLIENT_TOKEN`, while old builds continue to use `SERVER_CLIENT_TOKEN`.

For a staged rotation, the server accepts a comma-separated list:

```env
CALORIE_COUNTER_CLIENT_TOKENS=new_token,old_token
```

After most users update, remove `old_token` from the list. `SERVER_CLIENT_TOKEN` remains a compatibility fallback until it is removed from the server environment.

Generate a random token, for example:

```bash
openssl rand -hex 32
```

Restart the application after changing `.env`:

```bash
pm2 restart all
```

## Important limitation

A token embedded in a mobile app is a cost-control barrier, not proof that a request came from an untampered official app. Keep server-side rate limits and usage limits enabled.
