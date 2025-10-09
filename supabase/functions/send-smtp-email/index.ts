// supabase/functions/send-smtp-email/index.ts

// WICHTIG: Diese Funktion wurde umgestellt, um Resend (resend.com) anstelle von direktem SMTP zu verwenden.
// Direkter SMTP-Versand aus Supabase Edge Functions ist aufgrund von Netzwerk-Einschränkungen unzuverlässig.
// Resend bietet eine robuste API und eine hohe Zustellbarkeit.

// 1. Erstelle einen kostenlosen Account auf resend.com
// 2. Erstelle einen API-Schlüssel.
// 3. Füge den API-Schlüssel als Secret in deinem Supabase-Projekt hinzu:
//    Name: RESEND_API_KEY, Wert: re_...

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// HINWEIS: Um von deiner eigenen Domain zu senden, musst du sie in Resend verifizieren.
// Für den Anfang und zum Testen wird die Standard-Resend-Domain verwendet.
const FROM_EMAIL = 'Hundeschule <onboarding@resend.dev>';
const YOUR_DOMAIN_EMAIL = 'anmeldungen@hs-bw.com'; // Dies ist die E-Mail, an die geantwortet werden soll

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
      Bei Fragen antworte bitte direkt auf diese E-Mail.
    </p></div></body></html>
  `;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }});
  }
  
  try {
    if (!RESEND_API_KEY) {
        console.error("[send-smtp-email] FATAL: RESEND_API_KEY secret is not set.");
        throw new Error("RESEND_API_KEY ist nicht in den Supabase Secrets gesetzt.");
    }

    const { type, customerName, customerEmail, bookingId, events } = await req.json();
    console.log(`[send-smtp-email] Processing request for ${customerEmail}, type: ${type}`);

    const subject = type === 'new-booking' ? 'Deine Buchungsbestätigung für die Hundeschule' : 'Deine Buchung wurde aktualisiert';
    const title = type === 'new-booking' ? 'Buchung erfolgreich!' : 'Buchung aktualisiert!';
    const htmlContent = createEmailHtml(title, customerName, bookingId, events);

    console.log(`[send-smtp-email] Attempting to send email to ${customerEmail} via Resend API.`);

    const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
            from: FROM_EMAIL,
            to: customerEmail,
            subject: subject,
            html: htmlContent,
            reply_to: YOUR_DOMAIN_EMAIL
        }),
    });

    const responseData = await resendResponse.json();

    if (!resendResponse.ok) {
        console.error("[send-smtp-email] Resend API Error:", responseData);
        throw new Error(`Resend API returned status ${resendResponse.status}`);
    }
    
    console.log("[send-smtp-email] Email sent successfully via Resend:", responseData.id);
    
    return new Response(JSON.stringify({ message: 'Email sent successfully!' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error("[send-smtp-email] Function Error:", error.message);
    return new Response(JSON.stringify({ error: "Die E-Mail konnte nicht gesendet werden.", details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
