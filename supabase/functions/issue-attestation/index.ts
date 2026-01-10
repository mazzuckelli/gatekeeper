import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { SignJWT, importJWK } from "https://deno.land/x/jose@v5.2.0/index.ts";

/**
 * Issue Attestation Endpoint
 *
 * Purpose:
 * - Verify the user has a valid Gatekeeper session (biometric/password verified)
 * - Issue a signed attestation proving "a valid user just authenticated"
 * - Returns NO user_id, NO email, NO identifying information
 *
 * The attestation only proves: "A legitimate, authenticated human is present right now."
 *
 * Environment variables required:
 * - SUPABASE_URL: Gatekeeper Supabase URL (auto-injected)
 * - SUPABASE_SECRET_KEY: Gatekeeper Supabase secret key (new format: sb_secret_*)
 * - ATTESTATION_SIGNING_KEY: Key to sign attestations (ES256/P-256 JWK)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Get the authorization header (Supabase JWT from authenticated user)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the user's session with Supabase
    // Edge functions have these auto-injected by Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // Use secret key for server-side user verification (new format: sb_secret_*)
    const supabaseKey = Deno.env.get("SUPABASE_SECRET_KEY")!;

    // Extract the JWT from the auth header
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the user from the token - service role can verify any JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User is verified. Now issue attestation.
    // IMPORTANT: We do NOT include user.id or user.email in the attestation.

    // Get the signing key
    const signingKeyJson = Deno.env.get("ATTESTATION_SIGNING_KEY");
    if (!signingKeyJson) {
      console.error("ATTESTATION_SIGNING_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the JWK and import using jose
    const keyData = JSON.parse(signingKeyJson);
    const privateKey = await importJWK(keyData, "ES256");

    // Create the attestation JWT
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 300; // 5 minutes - short-lived

    const attestation = await new SignJWT({
      type: "attestation",
      valid: true,
      auth_level: "authenticated", // Could be "biometric" if we track that
    })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer("gatekeeper")
      .setAudience("ghost-auth")
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setJti(crypto.randomUUID()) // Prevent replay
      .sign(privateKey);

    // Return the attestation
    return new Response(
      JSON.stringify({
        attestation,
        expires_in: expiresIn,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (err) {
    console.error("Issue attestation error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Internal server error: ${errorMessage}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
