import { authorizeCalorieCounterRequest } from '../../../../lib/calorieCounterRequestAuth';
import { getCalorieCounterConfig } from '../../../../lib/calorieCounterConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function responseHeaders(req: Request): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: responseHeaders(req) });
}

export async function GET(req: Request): Promise<Response> {
  const headers = responseHeaders(req);
  // Reuse the authentication already required by CalorieCounterAI's AI routes.
  const auth = await authorizeCalorieCounterRequest(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status, headers });
  }
  return Response.json(getCalorieCounterConfig(), { status: 200, headers });
}
