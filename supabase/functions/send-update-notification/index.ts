// supabase/functions/send-update-notification/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'Hundeschule <anmeldungen@pfotencard.hs-bw.com>';

const CATEGORY_COLORS = {
    "Orchid": { bg: "Orchid", text: "#1a1a1a" },
    "LimeGreen": { bg: "LimeGreen", text: "#1a1a1a" },
    "SkyBlue": { bg: "SkyBlue", text: "#1a1a1a" },
    "Peru": { bg: "Peru", text: "white" },
    "Gold": { bg: "Gold", text: "#1a1a1a" },
    "White": { bg: "White", text: "#1a1a1a" },
    "DarkKhaki": { bg: "DarkKhaki", text: "#1a1a1a" },
    "Tomato": { bg: "Tomato", text: "white" }
};

function createUpdateEmailHtml(customerName: string, event: any) {
  const styleInfo = CATEGORY_COLORS[event.category] || { bg: '#fff3cd', text: '#333' };
  const eventStyle = `background-color: ${styleInfo.bg}; color: ${styleInfo.text}; border: 1px solid #dee2e6; padding: 15px; margin: 20px 0; border-radius: 6px;`;
  
  return `
    <!DOCTYPE html><html><head><style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header { font-size: 24px; color: #ffc107; margin: 0 0 10px; }
    </style></head><body><div class="container">
    <h1 class="header">Wichtige Info: Event-Änderung</h1><p>Hallo ${customerName},</p>
    <p>bitte beachte, dass sich die Details für eines deiner gebuchten Events geändert haben. Hier sind die neuen Informationen:</p>
    <div style="${eventStyle}">
      <p style="margin: 0; font-weight: bold; font-size: 16px; color: ${styleInfo.text};">${event.title}</p>
      <p style="margin: 5px 0 0; color: ${styleInfo.text}; opacity: 0.9;"><strong>Neuer Termin:</strong> ${event.date}</p>
      <p style="margin: 5px 0 0; color: ${styleInfo.text}; opacity: 0.9;"><strong>Neuer Ort:</strong> ${event.location}</p>
    </div>
    <p>Deine Anmeldung für dieses Event wurde automatisch auf die neuen Daten übertragen.</p>
    <div style="text-align: center; margin: 25px 0;">
      <a href="https://pfoten-event.vercel.app/?view=manage" target="_blank" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Alle Buchungen ansehen
      </a>
    </div>
    <p style="margin-top: 20px; font-size: 12px; color: #888; text-align: center;">
      Dies ist eine automatisch generierte E-Mail. Bei Fragen antworte bitte auf anmeldungen@pfotencard.hs-bw.com.
    </p></div></body></html>
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

    const { customers, event } = await req.json();
    console.log(`[send-update-notification] Processing request for ${customers.length} customers for event "${event.title}".`);

    for (const customer of customers) {
        if (!customer.email || !customer.name) {
            console.warn("[send-update-notification] Skipping customer with missing data:", customer);
            continue;
        }

        const htmlContent = createUpdateEmailHtml(customer.name, event);

        const emailPayload = {
            from: FROM_EMAIL,
            to: customer.email,
            subject: 'Wichtige Änderung bei deiner Event-Buchung',
            html: htmlContent,
            reply_to: 'anmeldungen@pfotencard.hs-bw.com'
        };
        
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