# evsi.store — Dishkin production changes (2026-07-13)

## What changed

- The Dishkin recipe sync proxy accepts and forwards an optional validated anonymous `voterId`.
- The AI refinement prompt now requires a newly generated image prompt for every refined recipe.

## Deployment

No database migration or new required secret was added in this project. Keep the existing Dishkin sync credentials unchanged, build, and restart with the current production process.

Deploy after `dishkin.com` and before publishing the updated mobile app.
