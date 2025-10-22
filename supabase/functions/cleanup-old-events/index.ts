// supabase/functions/cleanup-old-events/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create an admin Supabase client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get the current time in UTC
    const now = new Date().toISOString();
    console.log(`[cleanup-old-events] Running job at ${now}. Deleting events with date before this time.`);

    // Delete events where the 'date' is in the past
    const { data, error, count } = await supabaseAdmin
      .from('events')
      .delete({ count: 'exact' })
      .lt('date', now);

    if (error) {
      console.error('[cleanup-old-events] Error deleting old events:', error.message);
      throw error;
    }

    const message = `[cleanup-old-events] Successfully deleted ${count ?? 0} old events.`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message, deletedCount: count }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[cleanup-old-events] Function failed:', error.message);
    return new Response(JSON.stringify({ success: false, error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
