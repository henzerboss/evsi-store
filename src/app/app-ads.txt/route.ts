const SOURCE_URL =
  'https://raw.githubusercontent.com/cleveradssolutions/App-ads.txt/main/app-ads.txt';

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET() {
  try {
    const upstream = await fetch(SOURCE_URL, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'evsi.store app-ads.txt proxy',
      },
      next: {
        revalidate: 3600,
      },
    });

    if (!upstream.ok) {
      throw new Error(`GitHub returned ${upstream.status}`);
    }

    const content = await upstream.text();

    if (!content.trim()) {
      throw new Error('GitHub returned an empty app-ads.txt');
    }

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control':
          'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[app-ads.txt]', error);

    // Если GitHub временно не удалось прочитать через сервер,
    // отправляем crawler напрямую на raw-файл.
    return Response.redirect(SOURCE_URL, 307);
  }
}