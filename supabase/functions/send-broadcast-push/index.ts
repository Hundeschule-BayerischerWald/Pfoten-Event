// supabase/functions/send-broadcast-push/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from "https://esm.sh/web-push@3.6.7";

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

// HARDCODED VAPID KEYS (Vom Benutzer bereitgestellt)
// Hinweis: Normalerweise sollten private Keys in Supabase Secrets (Deno.env.get) gespeichert werden.
const VAPID_SUBJECT = 'mailto: <anmeldungen@pfotencard.hs-bw.com>';
const VAPID_PUBLIC_KEY = 'BHGjrm6VHcfPC2zdQxLDMgGC3n8y27miG-tlkDlBu0Kd250Pzy50QBXH4M-unooECqvnOyM-xiwxovVuuSMJb5o';
const VAPID_PRIVATE_KEY = '2twa17Kl8pw1MVIG0kuuHfYsjnE-hsktYdeA0oxWwiE';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }});
  }

  try {
    const { title, body, url } = await req.json();

    // Configure web-push
    webpush.setVapidDetails(
      VAPID_SUBJECT,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    // Initialize Admin Client to read subscriptions
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch all subscriptions
    const { data: subscriptions, error: dbError } = await supabaseAdmin
        .from('push_subscriptions')
        .select('*');

    if (dbError) throw dbError;

    console.log(`[send-broadcast-push] Sending to ${subscriptions.length} subscribers.`);

    const notificationPayload = JSON.stringify({
        title: title || 'Hundeschule Info',
        body: body || 'Es gibt Neuigkeiten!',
        url: url || '/'
    });

    const results = await Promise.allSettled(
        subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification(sub.subscription, notificationPayload);
                return { status: 'fulfilled', id: sub.id };
            } catch (err) {
                // Check for 410 Gone or 404 Not Found (subscription expired)
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`[send-broadcast-push] Deleting expired subscription ${sub.id}`);
                    await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
                }
                throw err;
            }
        })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.length - successCount;

    return new Response(JSON.stringify({ 
        message: 'Broadcast completed', 
        success: successCount, 
        failed: failureCount 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error("[send-broadcast-push] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});