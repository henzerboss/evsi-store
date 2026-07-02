import { cors, checkRateLimit } from '../../cookly/_shared';

export const runtime = 'nodejs';

type PlatformName = 'ios' | 'android';

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

function parseVersion(version: string): number[] {
  return version
    .split(/[.+\-]/)
    .map((part) => Number.parseInt(part.replace(/\D/g, ''), 10))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const len = Math.max(av.length, bv.length, 3);
  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function settingsFor(platform: PlatformName, currentVersion: string) {
  const prefix = platform === 'ios' ? 'DISHKIN_IOS' : 'DISHKIN_ANDROID';
  const latestVersion = envValue(`${prefix}_LATEST_VERSION`) || currentVersion;
  const minimumVersion = envValue(`${prefix}_MIN_VERSION`) || null;
  const releaseNotes = envValue(`${prefix}_RELEASE_NOTES`);
  const storeUrl =
    platform === 'ios'
      ? envValue('DISHKIN_IOS_STORE_URL') || 'https://apps.apple.com/app/id6784972752'
      : envValue('DISHKIN_ANDROID_STORE_URL') || 'https://play.google.com/store/apps/details?id=store.evsi.recipesgenerator';

  return { latestVersion, minimumVersion, releaseNotes, storeUrl };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function GET(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) };

  const clientToken = req.headers.get('X-Client-Token');
  if (process.env.COOKLY_CLIENT_TOKEN && clientToken !== process.env.COOKLY_CLIENT_TOKEN) {
    return json({ error: 'unauthorized' }, 401, headers);
  }

  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return json({ error: 'rate_limited' }, 429, headers);
  }

  const url = new URL(req.url);
  const platform = url.searchParams.get('platform') as PlatformName | null;
  const currentVersion = url.searchParams.get('version')?.trim() || '0.0.0';
  const build = url.searchParams.get('build')?.trim() || null;

  if (platform !== 'ios' && platform !== 'android') {
    return json({ error: 'bad_platform' }, 400, headers);
  }

  const settings = settingsFor(platform, currentVersion);
  const latestCompare = compareVersions(settings.latestVersion, currentVersion);
  const minCompare = settings.minimumVersion ? compareVersions(settings.minimumVersion, currentVersion) : -1;
  const mandatory = !!settings.minimumVersion && minCompare > 0;
  const updateAvailable = latestCompare > 0 || mandatory;

  return json(
    {
      ok: true,
      platform,
      currentVersion,
      build,
      latestVersion: settings.latestVersion,
      minimumVersion: settings.minimumVersion,
      updateAvailable,
      mandatory,
      storeUrl: settings.storeUrl,
      releaseNotes: settings.releaseNotes,
    },
    200,
    headers
  );
}
