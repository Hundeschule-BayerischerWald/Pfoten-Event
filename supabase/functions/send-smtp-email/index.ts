// supabase/functions/send-smtp-email/index.ts

// WICHTIG: Diese Funktion wurde umgestellt, um Resend (resend.com) anstelle von direktem SMTP zu verwenden.
// Direkter SMTP-Versand aus Supabase Edge Functions ist aufgrund von Netzwerk-Einschränkungen unzuverlässig.
// Resend bietet eine robuste API und eine hohe Zustellbarkeit.

// 1. Erstelle einen kostenlosen Account auf resend.com
// 2. Erstelle einen API-Schlüssel.
// 3. Füge den API-Schlüssel als Secret in deinem Supabase-Projekt hinzu:
//    Name: RESEND_API_KEY, Wert: re_...
// 4. VERIFIZIERE DEINE DOMAIN (z.B. hs-bw.com) IN DEINEM RESEND ACCOUNT.
// 5. Lade das Info-PDF in einen öffentlichen Storage-Bucket "assets" hoch.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Buffer } from "https://deno.land/std@0.140.0/node/buffer.ts";

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'Hundeschule <anmeldungen@pfotencard.hs-bw.com>';
const EMAIL_HEADER_IMAGE_URL = 'https://hs-bw.com/wp-content/uploads/2024/12/Tasse4.jpg';

// WICHTIG: Das PDF muss in einem öffentlichen Supabase Storage Bucket namens "assets" liegen.
const PDF_ATTACHMENT_URL = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/assets/Wichtige-Infos-zur-Anmeldung.pdf`;


const CATEGORY_COLORS = {
    "Orchid": { bg: "Orchid", text: "#1a1a1a" },
    "LimeGreen": { bg: "LimeGreen", text: "#1a1a1a" },
    "SkyBlue": { bg: "SkyBlue", text: "#1a1a1a" },
    "Peru": { bg: "Peru", text: "white" },
    "Gold": { bg: "Gold", text: "#1a1a1a" },
    "White": { bg: "#F6F6C9", text: "#1a1a1a" },
    "DarkKhaki": { bg: "DarkKhaki", text: "#1a1a1a" },
    "Tomato": { bg: "Tomato", text: "white" }
};

function createEmailHtml(title: string, customerName: string, bookingId: string, events: any[], manageUrl: string, type: string) {
  const eventsHtml = events.map(event => {
    const styleInfo = CATEGORY_COLORS[event.category] || { bg: '#f0f0f0', text: '#333' };
    const eventStyle = `background-color: ${styleInfo.bg}; color: ${styleInfo.text}; border: 1px solid rgba(0,0,0,0.1); padding: 12px 15px; margin-bottom: 8px; border-radius: 12px; font-size: 14px; line-height: 1.5;`;
    
    return `
      <div style="${eventStyle}">
        <div style="font-size: 15px; font-weight: bold; color: ${styleInfo.text}; margin-bottom: 5px;">${event.title}</div>
        <div style="font-size: 13px; color: ${styleInfo.text}; opacity: 0.9;">
          ${event.date} &bull; Ort: ${event.location}
        </div>
      </div>
    `
  }).join('');

  const introductoryText = type === 'new-booking'
    ? `<p>Hallo ${customerName},</p><p>vielen Dank! Hier ist die Zusammenfassung deiner Termine:</p>`
    : `<p>Hier ist die Zusammenfassung deiner Termine:</p>`;

  return `
    <!DOCTYPE html><html><head><style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .content { padding: 20px; }
    .header { font-size: 24px; color: #28a745; margin: 0 0 10px; }
    .booking-id { background-color: #e9ecef; padding: 10px; border-radius: 12px; text-align: center; margin-top: 15px; }
    </style></head><body><div class="container">
    <img src="${EMAIL_HEADER_IMAGE_URL}" alt="Hundeschule Banner" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
    <div class="content">
        <h1 class="header">${title}</h1>${introductoryText}${eventsHtml}
        <div class="booking-id">Deine Buchungsnummer lautet: <strong>${bookingId}</strong></div>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${manageUrl}" target="_blank" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block;">
            Meine Buchungen verwalten
          </a>
        </div>
        <p style="margin-top: 20px; font-size: 12px; color: #888; text-align: center;">
          Dies ist eine automatisch generierte E-Mail. Bitte antworte nicht darauf.
        </p>
    </div></div></body></html>
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

    // Fetch PDF attachment
    let pdfAttachment;
    try {
        console.log(`[send-smtp-email] Fetching PDF attachment from: ${PDF_ATTACHMENT_URL}`);
        const pdfResponse = await fetch(PDF_ATTACHMENT_URL);
        if (pdfResponse.ok) {
            const pdfArrayBuffer = await pdfResponse.arrayBuffer();
            const pdfBase64 = Buffer.from(pdfArrayBuffer).toString('base64');
            pdfAttachment = {
                filename: 'Wichtige-Infos-zur-Anmeldung.pdf',
                content: pdfBase64,
            };
            console.log("[send-smtp-email] Successfully fetched and encoded PDF attachment.");
        } else {
            console.warn(`[send-smtp-email] Failed to fetch PDF. Status: ${pdfResponse.status}. Email will be sent without attachment.`);
        }
    } catch (pdfError) {
        console.error("[send-smtp-email] Error fetching or processing PDF attachment:", pdfError.message);
    }

    const subject = type === 'new-booking' ? 'Deine Buchungsbestätigung für die Hundeschule' : 'Deine Buchung wurde aktualisiert';
    const title = type === 'new-booking' ? 'Buchung erfolgreich!' : 'Deine Buchung wurde aktualisiert';
    
    const manageUrl = `https://pfoten-event.vercel.app/?view=manage&bookingId=${bookingId}`;
    const htmlContent = createEmailHtml(title, customerName, bookingId, events, manageUrl, type);

    const emailPayload: any = {
        from: FROM_EMAIL,
        to: customerEmail,
        subject: subject,
        html: htmlContent,
        reply_to: 'anmeldungen@pfotencard.hs-bw.com'
    };
    
    if (pdfAttachment) {
        emailPayload.attachments = [pdfAttachment];
    }
    
    console.log(`[send-smtp-email] Attempting to send email to ${customerEmail} via Resend API.`);
    const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify(emailPayload),
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