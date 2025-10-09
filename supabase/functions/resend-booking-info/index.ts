// supabase/functions/resend-booking-info/index.ts

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { SmtpClient } from 'https://deno.land/x/smtp/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- SMTP KONFIGURATION (identisch zur ersten Funktion) ---
const SMTP_HOST = 'host105.alfahosting-server.de';
const SMTP_PORT = 587; // STARTTLS Port (Änderung von 465)
const SMTP_USER = 'anmeldungen@hs-bw.com';
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD');
const FROM_EMAIL = 'anmeldungen@hs-bw.com';
const SMTP_TIMEOUT_MS = 15000; // 15 seconds

// Helper to add a timeout to any promise
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage = 'Operation timed out'): Promise<T> {
  const timeout = new Promise<T>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(errorMessage));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

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
    console.log(`[resend-booking-info] Received ${req.method} request.`);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
    }

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
             // Still return a generic success message to the user for security
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
        const client = new SmtpClient();
        
        console.log(`[resend-booking-info] Attempting to connect to SMTP server: ${SMTP_HOST}:${SMTP_PORT} using STARTTLS.`);
        await withTimeout(
            client.connect({
                hostname: SMTP_HOST,
                port: SMTP_PORT,
                username: SMTP_USER,
                password: SMTP_PASSWORD,
                startTls: true, // Wichtige Änderung für Port 587
            }),
            SMTP_TIMEOUT_MS,
            'SMTP connection timed out'
        );
        console.log("[resend-booking-info] SMTP connection successful.");

        console.log(`[resend-booking-info] Sending recovery email to ${email}`);
        await withTimeout(
            client.send({
                from: `Hundeschule <${FROM_EMAIL}>`,
                to: email,
                subject: "Deine angeforderten Buchungsnummern",
                html: htmlContent,
            }),
            SMTP_TIMEOUT_MS,
            'SMTP send operation timed out'
        );
        await client.close();
        console.log("[resend-booking-info] Recovery email sent and connection closed.");

        return new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
            status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error("[resend-booking-info] Function Error:", error);
        let errorMessage = "Ein interner Fehler ist aufgetreten. Die E-Mail konnte nicht gesendet werden.";
        if (error.message.toLowerCase().includes('timed out')) {
            errorMessage = `Der E-Mail-Server (${SMTP_HOST}) antwortet nicht. Die Verbindung wurde nach ${SMTP_TIMEOUT_MS / 1000} Sekunden abgebrochen.`;
        } else if (error.message.toLowerCase().includes('authentication')) {
            errorMessage = "Anmeldung am E-Mail-Server fehlgeschlagen. Bitte überprüfe die Zugangsdaten.";
        }
        
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
});