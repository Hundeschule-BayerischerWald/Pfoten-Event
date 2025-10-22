// supabase/functions/send-push-notification/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { WebPush, WebPushError, type PushSubscription } from "jsr:@negrel/webpush@0.5.0";

// Hilfsvariable, um Deno-spezifische APIs in Nicht-Deno-Umgebungen zu umgehen.
declare const Deno: any;

// --- VAPID KEYS ---
// Lade die VAPID-Schlüssel sicher aus den Supabase Secrets.
const VAPID_PUBLIC_KEY = Deno.env.get("SUPABASE_VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("SUPABASE_VAPID_PRIVATE_KEY");

// Sicherheitsprüfung: Stelle sicher, dass die Schlüssel vorhanden sind.
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("FATAL: VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY müssen in den Supabase Secrets gesetzt sein.");
}

// Erstelle eine WebPush-Instanz mit den VAPID-Details.
// Die E-Mail-Adresse sollte ein Kontaktpunkt für den Push-Dienst sein.
const webpush = new WebPush(
  new URL("mailto:info@hs-bw.com"),
  VAPID_PUBLIC_KEY!,
  VAPID_PRIVATE_KEY!
);

serve(async (req) => {
  // Standard-Header für CORS und Content-Type
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json'
  };

  // Behandle CORS Preflight-Anfragen
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    // Erstelle einen Supabase-Admin-Client, um auf die Datenbank zuzugreifen.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // 1. Lade alle gespeicherten Push-Abonnements aus der Datenbank.
    const { data: subscriptions, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('subscription_data');

    if (error) throw error;
    
    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "Keine Abonnements für den Versand von Benachrichtigungen gefunden." }), {
        status: 200,
        headers,
      });
    }

    // 2. Definiere den Inhalt der Benachrichtigung.
    const notificationPayload = JSON.stringify({
      title: 'Hundeschule Pfoten-Event',
      body: 'Neue Events sind jetzt buchbar!',
      icon: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png',
      badge: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png'
    });
    
    let successCount = 0;
    let failureCount = 0;

    // 3. Sende die Benachrichtigung an jedes Abonnement.
    const sendPromises = subscriptions.map(async (sub) => {
      // Stelle sicher, dass `subscription_data` das korrekte Format hat.
      const subscription = sub.subscription_data as PushSubscription;
      
      try {
        await webpush.send(subscription, notificationPayload);
        successCount++;
      } catch (err) {
        failureCount++;
        console.error(`Fehler beim Senden an ${subscription.endpoint}:`, err.message);
        
        // 4. Aufräumen: Wenn ein Abonnement abgelaufen oder ungültig ist, lösche es.
        if (err instanceof WebPushError && (err.statusCode === 410 || err.statusCode === 404)) {
          console.log(`Abonnement ist ungültig. Lösche es aus der DB: ${subscription.endpoint}`);
          await supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('subscription_data->>endpoint', subscription.endpoint);
        }
      }
    });

    // Warte, bis alle Sendeversuche abgeschlossen sind.
    await Promise.all(sendPromises);

    const message = `Benachrichtigungen versendet. Erfolgreich: ${successCount}, Fehlgeschlagen: ${failureCount}`;
    console.log(message);

    return new Response(JSON.stringify({ message }), {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error("Fehler in der Edge Function:", error.message);
    return new Response(JSON.stringify({ error: "Fehler beim Senden der Push-Benachrichtigungen.", details: error.message }), {
      status: 500,
      headers,
    });
  }
});
