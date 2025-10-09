// supabase/functions/resend-booking-info/index.ts

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// KORREKTE IMPORTIERUNG: Wir importieren die SmtpClient-Klasse.
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- SMTP KONFIGURATION (identisch zur ersten Funktion) ---
const SMTP_HOST = 'host105.alfahosting-server.de';
const SMTP_PORT = 587; // STARTTLS Port
const SMTP_USER = 'anmeldungen@hs-bw.com';
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD');
const FROM_EMAIL = 'anmeldungen@hs-bw.com';


// Hilfsfunktion zum Erstellen der HTML-E-Mail
function createRecoveryEmailHtml(customerName: string, bookingIds: string[]) {
    const bookingsHtml = bookingIds.map(id => `
        <li style="font-size: 16px; background-color: #f0f0f0; padding: 10px; border-radius: 4px; margin-bottom: 5px; font-family: monospace;">${id}</li>
    `).join('');

    return `
        <!DOCTYPE html><html><head><style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; }
        .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { font-size: 24px; color: #007bff; margin: 0 0 10px; }
        ul { list-style: none; padding: 0; }
        </style></head><body><div class="container">
        <h1 class="header">Deine Buchungsnummern</h1><p>Hallo ${customerName},</p>
        <p>du hast deine Buchungsnummern bei uns angefordert. Hier sind alle Nummern, die unter deiner E-Mail-Adresse registriert sind:</p>
        <ul>${bookingsHtml}</ul>
        <p style="margin-top: 20px;">Du kannst diese Nummern nun verwenden, um deine Buchungen zu verwalten.</p>
        <p style="margin-top: 20px; font-size: 12px; color: #888;">
          Dies ist eine automatisch generierte E-Mail.
        </p></div></body></html>
    `;
}

serve(async (req) => {
  // CORS Preflight Request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' 
    }});
  }
  
  // Die Client-Instanz wird außerhalb des try-Blocks deklariert,
  // damit sie im finally-Block zugänglich ist.
  const client = new SmtpClient();

    try {
        const { email } = await req.json();
        if (!email) {
            throw new Error("E-Mail fehlt in der Anfrage.");
        }
        console.log(`[resend-booking-info] Processing request for email: ${email}`);

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        console.log("[resend-booking-info] Supabase admin client initialized.");
        
        console.log("[resend-booking-info] Searching for customer...");
        const { data: customerData, error: customerError } = await supabaseAdmin
            .from('customers')
            .select('id, name')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        if (customerError) {
             console.error('[resend-booking-info] Error fetching customer:', customerError.message);
             // Aus Sicherheitsgründen immer eine generische Erfolgsmeldung zurückgeben
             return new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
                status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
             });
        }
        
        if (!customerData) {
            console.log(`[resend-booking-info] Customer with email ${email} not found. Sending no email.`);
            return new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
                status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
        console.log(`[resend-booking-info] Customer found: ID ${customerData.id}`);

        console.log(`[resend-booking-info] Searching for bookings for customer ID ${customerData.id}`);
        const { data: bookingData, error: bookingError } = await supabaseAdmin
            .from('bookings')
            .select('id')
            .eq('customer_id', customerData.id);

        if (bookingError) {
             console.error('[resend-booking-info] Error fetching bookings:', bookingError.message);
             return new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
                status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
             });
        }

        if (!bookingData || bookingData.length === 0) {
            console.log(`[resend-booking-info] No bookings found for customer ID ${customerData.id}. Sending no email.`);
            return new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
                status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        const bookingIds = bookingData.map(b => b.id);
        console.log(`[resend-booking-info] Found ${bookingIds.length} booking(s). Preparing to send email.`);
        
        if (!SMTP_PASSWORD) {
            console.error("[resend-booking-info] FATAL: SMTP_PASSWORD secret is not set.");
            throw new Error("SMTP_PASSWORD ist nicht in den Supabase Secrets gesetzt.");
        }
        
        const htmlContent = createRecoveryEmailHtml(customerData.name, bookingIds);
        
        console.log(`[resend-booking-info] Connecting to SMTP server ${SMTP_HOST}:${SMTP_PORT}...`);
        await client.connectTLS({
          hostname: SMTP_HOST,
          port: SMTP_PORT,
          username: SMTP_USER,
          password: SMTP_PASSWORD,
        });
        console.log("[resend-booking-info] SMTP connection successful.");
        
        console.log(`[resend-booking-info] Attempting to send recovery email to ${email}`);
        await client.send({
          from: `Hundeschule <${FROM_EMAIL}>`,
          to: email,
          subject: "Deine angeforderten Buchungsnummern",
          html: htmlContent,
        });
        console.log("[resend-booking-info] Recovery email sent.");

        return new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
            status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error("[resend-booking-info] Function Error:", error);
        // Auch bei einem internen Fehler geben wir eine generische Antwort zurück,
        // um keine Informationen über das System preiszugeben.
        return new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
            status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } finally {
        // Stelle sicher, dass die Verbindung immer geschlossen wird.
        if (client.isConnected()) {
            console.log("[resend-booking-info] Closing SMTP connection.");
            await client.close();
        }
    }
});
