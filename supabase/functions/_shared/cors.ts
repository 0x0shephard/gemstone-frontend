export const corsHeaders = {
  // Authentication and SIWE origin validation provide authorization. A wildcard
  // here allows the browser to receive sanitized error bodies from each explicit
  // development origin without using cookies or credentialed CORS.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function preflight(request: Request): Response | undefined {
  return request.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : undefined;
}
