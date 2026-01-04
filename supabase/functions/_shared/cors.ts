/**
 * CORS Configuration for Gatekeeper
 *
 * Centralized CORS handling for all Gatekeeper Edge Functions.
 * Only allows requests from approved origins.
 *
 * SECURITY: This prevents malicious sites from making API requests
 * using your users' credentials (CSRF attacks via cross-origin requests).
 */

// Approved origins - requests from other origins will be rejected
const ALLOWED_ORIGINS = [
  // Production
  'https://gatekeeper-nine.vercel.app',    // Gatekeeper web production
  'https://xenon-engine-web.vercel.app',   // Goals web production

  // Dawg Tag Mobile (Expo)
  'exp://localhost:8081',                  // Expo Go development
  'exp://192.168.1.1:8081',                // Expo Go on local network (adjust IP as needed)

  // Local development
  'http://localhost:3000',                 // Local web development
  'http://127.0.0.1:3000',                 // Local web development (alt)
  'http://localhost:3001',                 // Gatekeeper test app
  'http://127.0.0.1:3001',                 // Gatekeeper test app (alt)
  'http://localhost:5173',                 // Vite dev server
  'http://127.0.0.1:5173',                 // Vite dev server (alt)
  'http://localhost:8080',                 // Alternative local
  'http://localhost:8081',                 // Expo Metro bundler
  'http://localhost:19006',                // Expo web
] as const;

/**
 * Check if a request origin is allowed.
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin as typeof ALLOWED_ORIGINS[number]);
}

/**
 * Get CORS headers for a given request origin.
 * Returns headers that only allow the origin if it's in our approved list.
 */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && isOriginAllowed(origin)
    ? origin
    : ALLOWED_ORIGINS[0]; // Default to production (won't work for disallowed origins anyway)

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
  };
}

/**
 * Handle CORS preflight (OPTIONS) request.
 */
export function handleCors(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;

  const origin = req.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/**
 * Create a JSON response with proper CORS headers.
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  origin?: string | null
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(origin ?? null),
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create an error response with proper CORS headers.
 */
export function errorResponse(
  message: string,
  status = 400,
  origin?: string | null
): Response {
  return jsonResponse({ error: message }, status, origin);
}

// Legacy export for backwards compatibility
export const corsHeaders = getCorsHeaders(null);
