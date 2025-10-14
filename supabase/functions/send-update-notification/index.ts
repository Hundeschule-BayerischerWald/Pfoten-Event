// supabase/functions/send-update-notification/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Buffer } from "https://deno.land/std@0.140.0/node/buffer.ts";

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

// --- KONFIGURATION ---
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'Hundeschule <anmeldungen@pfotencard.hs-bw.com>';
const REPLY_TO_EMAIL = 'info@hs-bw.com';
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

function createUpdateEmailHtml(customerName: string, event: any, manageUrl: string) {
  const styleInfo = CATEGORY_COLORS[event.category] || { bg: '#fff3cd', text: '#333' };
  const eventStyle = `background-color: ${styleInfo.bg}; color: ${styleInfo.text}; border: 1px solid rgba(0,0,0,0.1); padding: 12px 15px; margin: 20px 0; border-radius: 12px; font-size: 14px; line-height: 1.5;`;
  
  return `
    <!DOCTYPE html><html><head><style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .content { padding: 20px; }
    .header { font-size: 24px; color: #ffc107; margin: 0 0 10px; }
    </style></head><body><div class="container">
    <img src="${EMAIL_HEADER_IMAGE_URL}" alt="Hundeschule Banner" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
    <div class="content">
        <h1 class="header">Wichtige Info: Event-Änderung</h1><p>Hallo ${customerName},</p>
        <p>bitte beachte, dass sich die Details für eines deiner gebuchten Events geändert haben. Hier sind die neuen Informationen:</p>
        <div style="${eventStyle}">
          <div style="font-size: 15px; font-weight: bold; color: ${styleInfo.text}; margin-bottom: 5px;">${event.title}</div>
          <div style="font-size: 13px; color: ${styleInfo.text}; opacity: 0.9;">
            <strong>Neuer Termin:</strong> ${event.date}<br>
            <strong>Neuer Ort:</strong> ${event.location}
          </div>
        </div>
        <p>Deine Anmeldung für dieses Event wurde automatisch auf die neuen Daten übertragen.</p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${manageUrl}" target="_blank" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block;">
            Meine Buchungen verwalten
          </a>
        </div>
        <p style="margin-top: 20px; font-size: 12px; color: #888; text-align: center;">
          Dies ist eine automatisch generierte E-Mail. Bitte antworte nicht direkt auf diese Nachricht.<br><br>
          Bei Fragen oder Anliegen wende dich bitte an unser Team unter ${REPLY_TO_EMAIL}.<br><br>
          Vielen Dank und bis bald,<br>
          dein Team der Hundeschule Bayerischer Wald
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
        console.error("[send-update-notification] FATAL: RESEND_API_KEY secret is not set.");
        throw new Error("Serverkonfigurationsfehler: E-Mail-Dienst nicht eingerichtet.");
    }

    const { participants, event } = await req.json();
    console.log(`[send-update-notification] Processing request for ${participants.length} participants for event "${event.title}".`);

    // Fetch PDF attachment once before the loop
    let pdfAttachment;
    try {
        console.log(`[send-update-notification] Fetching PDF attachment from: ${PDF_ATTACHMENT_URL}`);
        const pdfResponse = await fetch(PDF_ATTACHMENT_URL);
        if (pdfResponse.ok) {
            const pdfArrayBuffer = await pdfResponse.arrayBuffer();
            const pdfBase64 = Buffer.from(pdfArrayBuffer).toString('base64');
            pdfAttachment = {
                filename: 'Wichtige-Infos-zur-Anmeldung.pdf',
                content: pdfBase64,
            };
            console.log("[send-update-notification] Successfully fetched and encoded PDF attachment.");
        } else {
            console.warn(`[send-update-notification] Failed to fetch PDF. Status: ${pdfResponse.status}. Email will be sent without attachment.`);
        }
    } catch (pdfError) {
        console.error("[send-update-notification] Error fetching or processing PDF attachment:", pdfError.message);
    }

    for (const participant of participants) {
        const { customer, bookingId } = participant;

        if (!customer || !customer.email || !customer.name || !bookingId) {
            console.warn("[send-update-notification] Skipping participant with missing data:", participant);
            continue;
        }

        const manageUrl = `https://pfoten-event.vercel.app/?view=manage&bookingId=${bookingId}`;
        const htmlContent = createUpdateEmailHtml(customer.name, event, manageUrl);

        const emailPayload: any = {
            from: FROM_EMAIL,
            to: customer.email,
            subject: 'Wichtige Änderung bei deiner Event-Buchung',
            html: htmlContent,
            reply_to: REPLY_TO_EMAIL
        };
        
        if (pdfAttachment) {
            emailPayload.attachments = [pdfAttachment];
        }
        
        console.log(`[send-update-notification] Attempting to send notification to ${customer.email} via Resend API.`);
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
            console.error(`[send-update-notification] Resend API Error for ${customer.email}:`, responseData);
        } else {
            console.log(`[send-update-notification] Notification sent successfully to ${customer.email}. ID: ${responseData.id}`);
        }
    }
    
    return new Response(JSON.stringify({ message: 'Notifications processed.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error("[send-update-notification] Function Error:", error.message);
    return new Response(JSON.stringify({ error: "Benachrichtigungen konnten nicht gesendet werden.", details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});