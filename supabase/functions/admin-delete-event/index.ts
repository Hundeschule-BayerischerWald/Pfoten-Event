// supabase/functions/admin-delete-event/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// declare Deno for non-deno environments
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
        // 1. Create a Supabase client with the user's auth token to check their role
        const userSupabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        );

        // 2. Verify the user is an admin or mitarbeiter
        const { data: { user } } = await userSupabaseClient.auth.getUser();
        const userRole = user?.user_metadata?.role;
        if (!user || (userRole !== 'admin' && userRole !== 'mitarbeiter')) {
            throw new Error('Permission denied: User does not have sufficient privileges.');
        }

        // 3. Get payload from the request
        const { eventId } = await req.json();
        if (!eventId) {
            throw new Error('Missing eventId in request body.');
        }

        // 4. Create a service role client to perform privileged operations
        const serviceRoleClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // 5. Fetch event details and all booked customers
        const { data: eventData, error: eventError } = await serviceRoleClient
            .from('events')
            .select('title, date, bookings_events(bookings(customers(name, email)))')
            .eq('id', eventId)
            .single();

        if (eventError) {
            // If the event is not found, it might have been deleted already.
            // Treat this as a success to avoid frontend errors for repeated clicks.
            if (eventError.code === 'PGRST116') {
                 console.warn(`[admin-delete-event] Event with ID ${eventId} not found. Assuming already deleted.`);
                 return new Response(JSON.stringify({ success: true, message: 'Event not found, assumed already deleted.' }), {
                    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            throw new Error(`Error fetching event data: ${eventError.message}`);
        }

        // 6. If there are participants, trigger cancellation emails
        const participants = eventData.bookings_events
            .map(be => be.bookings?.customers)
            .filter(Boolean); // Filter out any null/undefined customers

        if (participants.length > 0) {
            console.log(`[admin-delete-event] Found ${participants.length} participants for event ${eventId}. Triggering emails.`);
            const emailPromises = participants.map(customer =>
                serviceRoleClient.functions.invoke('send-smtp-email', {
                    body: {
                        type: 'event-cancelled-by-admin',
                        customerName: (customer as any).name,
                        customerEmail: (customer as any).email,
                        cancelledEvent: {
                            title: eventData.title,
                            date: new Date(eventData.date).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' }) + ' Uhr',
                        }
                    }
                })
            );
            
            // Wait for all email invocations to be sent. We don't want to fail the whole
            // process if one email fails, so we log errors individually.
            const results = await Promise.allSettled(emailPromises);
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.warn(`[admin-delete-event] Failed to send cancellation email to participant #${index + 1}:`, result.reason);
                }
            });
        }

        // 7. Delete all links in the `bookings_events` table for this event
        // This must happen before deleting the event itself due to foreign key constraints.
        const { error: deleteLinksError } = await serviceRoleClient
            .from('bookings_events')
            .delete()
            .eq('event_id', eventId);

        if (deleteLinksError) {
            throw new Error(`Failed to delete event bookings: ${deleteLinksError.message}`);
        }

        // 8. Delete the event itself
        const { error: deleteEventError } = await serviceRoleClient
            .from('events')
            .delete()
            .eq('id', eventId);

        if (deleteEventError) {
            throw new Error(`Failed to delete the event: ${deleteEventError.message}`);
        }
        
        console.log(`[admin-delete-event] Successfully deleted event ${eventId} and its ${participants.length} bookings.`);

        return new Response(JSON.stringify({ success: true, message: 'Event successfully deleted.' }), {
            status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[admin-delete-event] Function Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
});
