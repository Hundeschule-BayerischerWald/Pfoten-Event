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

    // --- Step 2: Find bookings that will be orphaned ---
    // A booking is orphaned if ALL of its events are in the oldEventIds list.
    // This approach loads all links to determine this in application logic.
    // It's acceptable for small to medium datasets.
    const { data: allLinks, error: linksError } = await supabaseAdmin.from('bookings_events').select('booking_id, event_id');
    if(linksError) throw linksError;

    const bookingsMap = new Map<string, string[]>();
    for(const link of allLinks) {
        if (!bookingsMap.has(link.booking_id)) {
            bookingsMap.set(link.booking_id, []);
        }
        bookingsMap.get(link.booking_id)!.push(link.event_id);
    }
    
    const orphanedBookingIds: string[] = [];
    for (const [bookingId, eventIds] of bookingsMap.entries()) {
        const isOrphaned = eventIds.every(eventId => oldEventIds.includes(eventId));
        if (isOrphaned) {
            orphanedBookingIds.push(bookingId);
        }
    }
    console.log(`[cleanup-old-events] Found ${orphanedBookingIds.length} booking(s) that will be orphaned.`);


    // --- Step 3: Find customers that will be orphaned ---
    let orphanedCustomerIds: string[] = [];
    if (orphanedBookingIds.length > 0) {
        // A customer is orphaned if ALL of their bookings are in the orphanedBookingIds list.
        const { data: allBookings, error: bookingsError } = await supabaseAdmin.from('bookings').select('id, customer_id');
        if (bookingsError) throw bookingsError;

        const customersMap = new Map<string, string[]>();
        // Group all bookings by customer_id
        for (const booking of allBookings) {
             // Only process customers with a valid customer_id
            if (booking.customer_id) {
                if (!customersMap.has(booking.customer_id)) {
                    customersMap.set(booking.customer_id, []);
                }
                customersMap.get(booking.customer_id)!.push(booking.id);
            }
        }

        for (const [customerId, bookingIds] of customersMap.entries()) {
            const isOrphaned = bookingIds.every(bookingId => orphanedBookingIds.includes(bookingId));
            if (isOrphaned) {
                orphanedCustomerIds.push(customerId);
            }
        }
         console.log(`[cleanup-old-events] Found ${orphanedCustomerIds.length} customer(s) that will be orphaned.`);
    }

    // --- Step 4: Perform deletions in order (dependencies first) ---
    
    // Delete links to old events. This is safe to do for all old events.
    const { error: deleteLinksError } = await supabaseAdmin
        .from('bookings_events')
        .delete()
        .in('event_id', oldEventIds);
    if(deleteLinksError) throw deleteLinksError;
    console.log(`[cleanup-old-events] Deleted links for ${oldEventIds.length} old event(s).`);

    // Delete orphaned bookings
    if (orphanedBookingIds.length > 0) {
        const { error: deleteBookingsError } = await supabaseAdmin
            .from('bookings')
            .delete()
            .in('id', orphanedBookingIds);
        if(deleteBookingsError) throw deleteBookingsError;
        console.log(`[cleanup-old-events] Deleted ${orphanedBookingIds.length} orphaned booking(s).`);
    }

    // Delete orphaned customers
    if (orphanedCustomerIds.length > 0) {
         const { error: deleteCustomersError } = await supabaseAdmin
            .from('customers')
            .delete()
            .in('id', orphanedCustomerIds);
        if(deleteCustomersError) throw deleteCustomersError;
        console.log(`[cleanup-old-events] Deleted ${orphanedCustomerIds.length} orphaned customer(s).`);
    }

    // Finally, delete the old events themselves
    const { count, error: deleteEventsError } = await supabaseAdmin
        .from('events')
        .delete({ count: 'exact' })
        .in('id', oldEventIds);
    if(deleteEventsError) throw deleteEventsError;
    
    const message = `[cleanup-old-events] Successfully deleted ${count ?? 0} old events and all associated orphaned data.`;
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
