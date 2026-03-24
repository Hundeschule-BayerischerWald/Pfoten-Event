// supabase/functions/admin-cancel-booking/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// declare Deno for non-deno environments
declare const Deno: any;

serve(async (req) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
    }

    try {
        // 1. Create a Supabase client with the user's auth token to check their role
        const userSupabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        );

        // 2. Verify the user is an admin
        const { data: { user } } = await userSupabaseClient.auth.getUser();
        if (!user || user.user_metadata?.role !== 'admin') {
            throw new Error('Permission denied: User is not an admin.');
        }

        // 3. Get payload from the request
        const { bookingId, eventId } = await req.json();
        if (!bookingId || !eventId) {
            throw new Error('Missing bookingId or eventId in request body.');
        }

        // 4. Create a service role client to perform privileged operations
        const serviceRoleClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // 5. Fetch details needed for the email BEFORE deleting the record
        const { data: bookingDetails, error: bookingError } = await serviceRoleClient
            .from('bookings')
            .select('id, customers(name, email)')
            .eq('id', bookingId)
            .single();

        if (bookingError || !bookingDetails || !bookingDetails.customers) {
             throw new Error(`Could not fetch booking details for ID: ${bookingId}.`);
        }
        
        const { data: cancelledEventDetails, error: eventError } = await serviceRoleClient
            .from('events')
            .select('title, date')
            .eq('id', eventId)
            .single();
        if(eventError) throw new Error(`Could not fetch cancelled event details for ID: ${eventId}.`);
        
        // 6. Perform the cancellation by deleting the link in bookings_events
        const { error: deleteError } = await serviceRoleClient
            .from('bookings_events')
            .delete()
            .match({ booking_id: bookingId, event_id: eventId });

        if (deleteError) {
            throw new Error(`Database error during cancellation: ${deleteError.message}`);
        }
        // The database trigger on this table will handle updating the event's booked_capacity.

        // 7. Fetch the remaining events for the notification email
        const { data: remainingLinks, error: linksError } = await serviceRoleClient
            .from('bookings_events')
            .select('event_id')
            .eq('booking_id', bookingId);
            
        if(linksError) throw linksError;

        let remainingEventsForEmail = [];
        if (remainingLinks && remainingLinks.length > 0) {
            const remainingEventIds = remainingLinks.map(link => link.event_id);
            const { data: remainingEventsData, error: remainingEventsError } = await serviceRoleClient
                .from('events')
                .select('title, date, location, category')
                .in('id', remainingEventIds)
                .order('date', { ascending: true });
            
            if(remainingEventsError) throw remainingEventsError;
            
            remainingEventsForEmail = remainingEventsData.map(e => ({
                ...e,
                date: new Date(e.date).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' }) + ' Uhr'
            }));
        }

        // 8. Invoke the email sending function with the updated event list
        const { error: invokeError } = await serviceRoleClient.functions.invoke('send-smtp-email', {
            body: {
                type: 'admin-cancellation',
                customerName: (bookingDetails.customers as any).name,
                customerEmail: (bookingDetails.customers as any).email,
                bookingId: bookingDetails.id,
                cancelledEvent: {
                    title: cancelledEventDetails.title,
                    date: new Date(cancelledEventDetails.date).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' }) + ' Uhr'
                },
                events: remainingEventsForEmail, // This is the updated list of remaining events
            }
        });
        
        if (invokeError) {
            // Log the error, but don't fail the whole operation since the cancellation itself was successful.
            console.warn(`Admin cancellation successful, but failed to send email for booking ${bookingId}:`, invokeError.message);
        }

        return new Response(JSON.stringify({ success: true, message: 'Booking cancelled successfully.' }), {
            status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[admin-cancel-booking] Function Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400, // Use 400 for client-side errors (like missing params) or permission issues
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
});