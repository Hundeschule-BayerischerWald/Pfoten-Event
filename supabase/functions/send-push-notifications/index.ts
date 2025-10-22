// supabase/functions/send-push-notifications/index.ts

// This function sends a "New Events Available" push notification to all subscribed users.
// It uses the 'jsr:@negrel/webpush' library, which is a modern choice for Deno.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

// Type definition for the subscription object stored in the database
interface PushSubscriptionRecord {
  id: number;
  subscription_object: webpush.PushSubscription;
}

// Set up CORS headers to allow requests from the app's domain
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
    // --- 1. Get Environment Variables ---
    const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables (VAPID keys or Supabase credentials).");
    }

    // --- 2. Initialize Admin Supabase Client ---
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- 3. Fetch All Push Subscriptions ---
    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, subscription_object')
      .returns<PushSubscriptionRecord[]>();

    if (fetchError) {
      console.error("Error fetching subscriptions:", fetchError.message);
      throw new Error("Could not fetch subscriptions from the database.");
    }
    
    if (!subscriptions || subscriptions.length === 0) {
        console.log("No subscriptions found. Exiting function.");
        return new Response(JSON.stringify({ message: "No active subscriptions to send notifications to.", sentCount: 0, deletedCount: 0 }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // --- 4. Prepare and Send Notifications ---
    const vapidKeys = {
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
    };
    
    // Configure web-push with VAPID details
    webpush.setVapidDetails('mailto:info@hs-bw.com', vapidKeys.publicKey, vapidKeys.privateKey);
    
    const notificationPayload = JSON.stringify({
      title: 'Pfoten-Event',
      body: 'Neue Events sind jetzt buchbar!',
    });

    const promises = subscriptions.map(record =>
      webpush.sendNotification(record.subscription_object, notificationPayload)
        .catch(error => {
          // If the subscription is expired or invalid, the push service returns an error.
          // We capture this error to delete the invalid subscription.
          if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`Subscription with ID ${record.id} is gone. Marking for deletion.`);
            return { deleteId: record.id };
          } else {
            console.error(`Failed to send notification to ID ${record.id}:`, error.message);
            // Return null for other errors so it's not counted as a success or deletion.
            return null; 
          }
        })
    );

    const results = await Promise.all(promises);

    // --- 5. Clean Up Invalid Subscriptions ---
    const idsToDelete = results
      .filter((r): r is { deleteId: number } => r !== null && typeof r === 'object' && 'deleteId' in r)
      .map(r => r.deleteId);

    if (idsToDelete.length > 0) {
      console.log(`Deleting ${idsToDelete.length} invalid subscriptions.`);
      const { error: deleteError } = await supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .in('id', idsToDelete);

      if (deleteError) {
        // Log the error but don't fail the entire function, as notifications might have been sent.
        console.error("Error deleting invalid subscriptions:", deleteError.message);
      }
    }
    
    const sentCount = results.filter(r => r !== null && !('deleteId' in r)).length;
    console.log(`Successfully sent ${sentCount} notifications.`);

    // --- 6. Return Success Response ---
    return new Response(JSON.stringify({ 
        message: 'Notifications sent successfully.',
        sentCount: sentCount,
        deletedCount: idsToDelete.length
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Function error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});