// supabase/functions/cleanup-old-events/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
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

    const now = new Date().toISOString();
    console.log(`[cleanup-old-events] Running job at ${now}.`);

    // --- Step 1: Find old events ---
    const { data: oldEvents, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('id')
      .lt('date', now);
      
    if (eventsError) throw eventsError;

    if (!oldEvents || oldEvents.length === 0) {
      console.log("[cleanup-old-events] No old events found to delete.");
      return new Response(JSON.stringify({ success: true, message: "No old events to delete.", deletedCount: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const oldEventIds = oldEvents.map(e => e.id);
    console.log(`[cleanup-old-events] Found ${oldEventIds.length} old event(s) to process.`);

    // --- Step 2: Delete links to old events ---
    // This removes the relationship in bookings_events table.
    // The bookings themselves (and customers) are NOT deleted, preserving the account.
    const { error: deleteLinksError } = await supabaseAdmin
        .from('bookings_events')
        .delete()
        .in('event_id', oldEventIds);
    if(deleteLinksError) throw deleteLinksError;
    console.log(`[cleanup-old-events] Deleted links for ${oldEventIds.length} old event(s).`);

    // --- Step 3: Delete the old events themselves ---
    const { count, error: deleteEventsError } = await supabaseAdmin
        .from('events')
        .delete({ count: 'exact' })
        .in('id', oldEventIds);
    if(deleteEventsError) throw deleteEventsError;
    
    // Note: We intentionally DO NOT delete orphaned bookings or customers anymore.
    // This allows the booking ID to act as a permanent customer account.

    const message = `[cleanup-old-events] Successfully deleted ${count ?? 0} old events. Bookings preserved.`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message, deletedCount: count }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('[cleanup-old-events] Function failed:', error.message);
    return new Response(JSON.stringify({ success: false, error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});