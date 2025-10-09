// supabase/functions/send-smtp-email/index.ts

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { SmtpClient } from "https://deno.land/x/smtp@v0.15.1/mod.ts";

// --- DEINE SMTP KONFIGURATION ---
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
function createEmailHtml(title: string, customerName: string, bookingId: string, events: any[]) {
  const eventsHtml = events.map(event => `
    <div style="background-color: #f0f0f0; border-left: 4px solid #007bff; padding: 10px 15px; margin-bottom: 10px; border-radius: 4px;">
      <p style="margin: 0; font-weight: bold; font-size: 16px;">${event.title}</p>
      <p style="margin: 5px 0 0; color: #555;">${event.date}</p>
      <p style="margin: 5px 0 0; color: #555;">Ort: ${event.location}</p>
    </div>
  `).join('');

  return `
    <!DOCTYPE html><html><head><style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header { font-size: 24px; color: #28a745; margin: 0 0 10px; }
    .booking-id { background-color: #e9ecef; padding: 10px; border-radius: 6px; text-align: center; margin-top: 15px; }
    </style></head><body><div class="container">
    <h1 class="header">${title}</h1><p>Hallo ${customerName},</p>
    <p>vielen Dank! Hier ist die Zusammenfassung deiner Termine:</p>${eventsHtml}
    <div class="booking-id">Deine Buchungsnummer lautet: <strong>${bookingId}</strong></div>
    <p style="margin-top: 20px; font-size: 12px; color: #888;">
      Dies ist eine automatisch generierte E-Mail. Bei Fragen antworte bitte nicht auf diese E-Mail, sondern kontaktiere uns direkt.
    </p></div></body></html>
  `;
}

serve(async (req) => {
  console.log(`[send-smtp-email] Received ${req.method} request.`);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' 
    }});
  }

  try {
    if (!SMTP_PASSWORD) {
        console.error("[send-smtp-email] FATAL: SMTP_PASSWORD secret is not set.");
        throw new Error("SMTP_PASSWORD ist nicht in den Supabase Secrets gesetzt. Bitte füge es hinzu.");
    }

    const { type, customerName, customerEmail, bookingId, events } = await req.json();
    console.log(`[send-smtp-email] Processing request for ${customerEmail}, type: ${type}`);

    const subject = type === 'new-booking' ? 'Deine Buchungsbestätigung für die Hundeschule' : 'Deine Buchung wurde aktualisiert';
    const title = type === 'new-booking' ? 'Buchung erfolgreich!' : 'Buchung aktualisiert!';
    const htmlContent = createEmailHtml(title, customerName, bookingId, events);

    const client = new SmtpClient();
    console.log(`[send-smtp-email] Attempting to connect to SMTP server: ${SMTP_HOST}:${SMTP_PORT} using STARTTLS.`);
    
    await withTimeout(
        client.connect({
            hostname: SMTP_HOST,
            port: SMTP_PORT,
            username: SMTP_USER,
            password: SMTP_PASSWORD,
            // STARTTLS wird von der neuen Bibliotheksversion automatisch gehandhabt
        }),
        SMTP_TIMEOUT_MS,
        'SMTP connection timed out'
    );
    console.log("[send-smtp-email] SMTP connection successful.");

    console.log(`[send-smtp-email] Sending email to ${customerEmail}`);
    await withTimeout(
        client.send({
            from: `Hundeschule <${FROM_EMAIL}>`,
            to: customerEmail,
            subject: subject,
            html: htmlContent,
        }),
        SMTP_TIMEOUT_MS,
        'SMTP send operation timed out'
    );
    console.log("[send-smtp-email] Email sent successfully.");

    await client.close();
    console.log("[send-smtp-email] SMTP connection closed.");

    return new Response(JSON.stringify({ message: 'Email sent successfully!' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error("[send-smtp-email] Function Error:", error);
    let errorMessage = "Ein interner Fehler ist aufgetreten. Die E-Mail konnte nicht gesendet werden.";
    if (error.message.toLowerCase().includes('timed out')) {
        errorMessage = `Der E-Mail-Server (${SMTP_HOST}) antwortet nicht. Die Verbindung wurde nach ${SMTP_TIMEOUT_MS / 1000} Sekunden abgebrochen.`;
    } else if (error.message.toLowerCase().includes('authentication')) {
        errorMessage = "Anmeldung am E-Mail-Server fehlgeschlagen. Bitte überprüfe die Zugangsdaten.";
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});