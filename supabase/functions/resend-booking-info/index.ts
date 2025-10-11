// supabase/functions/resend-booking-info/index.ts

// WICHTIG: Diese Funktion wurde umgestellt, um Resend (resend.com) anstelle von direktem SMTP zu verwenden.
// Direkter SMTP-Versand aus Supabase Edge Functions ist aufgrund von Netzwerk-Einschränkungen unzuverlässig.

// 1. Erstelle einen kostenlosen Account auf resend.com
// 2. Erstelle einen API-Schlüssel.
// 3. Füge den API-Schlüssel als Secret in deinem Supabase-Projekt hinzu:
//    Name: RESEND_API_KEY, Wert: re_...
// 4. VERIFIZIERE DEINE DOMAIN (z.B. hs-bw.com) IN DEINEM RESEND ACCOUNT.
// 5. [NEU] Lade das Info-PDF in einen öffentlichen Storage-Bucket "assets" hoch.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Buffer } from "https://deno.land/std@0.140.0/node/buffer.ts";

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'Hundeschule <anmeldungen@pfotencard.hs-bw.com>';
const EMAIL_HEADER_IMAGE_URL = 'https://hs-bw.com/wp-content/uploads/2024/12/Tasse4.jpg';

// WICHTIG: Das PDF muss in einem öffentlichen Supabase Storage Bucket namens "assets" liegen.
const PDF_ATTACHMENT_URL = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/assets/Wichtige-Infos-zur-Anmeldung.pdf`;

function createRecoveryEmailHtml(customerName: string, bookingIds: string[], manageUrl: string) {
    const bookingsHtml = bookingIds.map(id => `
        <li style="border: 1px solid #e0e0e0; background-color: #f9f9f9; padding: 8px 15px; margin-bottom: 8px; border-radius: 8px; font-family: monospace; font-size: 16px; text-align: center;">${id}</li>
    `).join('');

    return `
        <!DOCTYPE html><html><head><style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
        .content { padding: 20px; }
        .header { font-size: 24px; color: #007bff; margin: 0 0 10px; }
        ul { list-style: none; padding: 0; }
        </style></head><body><div class="container">
        <img src="${EMAIL_HEADER_IMAGE_URL}" alt="Hundeschule Banner" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
        <div class="content">
            <h1 class="header">Deine Buchungsnummern</h1><p>Hallo ${customerName},</p>
            <p>du hast deine Buchungsnummern bei uns angefordert. Hier sind alle Nummern, die unter deiner E-Mail-Adresse registriert sind:</p>
            <ul>${bookingsHtml}</ul>
            <p style="margin-top: 20px;">Du kannst diese Nummern nun verwenden, um deine Buchungen zu verwalten.</p>
            <div style="text-align: center; margin: 25px 0;">
              <a href="${manageUrl}" target="_blank" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Zur Buchungsverwaltung
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
    return new Response('ok', { headers: { 'Access-control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }});
  }
  
    const genericSuccessResponse = new Response(JSON.stringify({ message: 'Anfrage verarbeitet.' }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  
    try {
        const { email } = await req.json();
        if (!email) {
            console.warn("[resend-booking-info] Request received without email.");
            return genericSuccessResponse;
        }
        console.log(`[resend-booking-info] Processing request for email: ${email}`);

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        const { data: customerData, error: customerError } = await supabaseAdmin
            .from('customers')
            .select('id, name')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        if (customerError || !customerData) {
             if(customerError) console.error('[resend-booking-info] Error fetching customer:', customerError.message);
             else console.log(`[resend-booking-info] Customer with email ${email} not found. Sending no email.`);
             return genericSuccessResponse;
        }
        console.log(`[resend-booking-info] Customer found: ID ${customerData.id}`);

        const { data: bookingData, error: bookingError } = await supabaseAdmin
            .from('bookings')
            .select('id')
            .eq('customer_id', customerData.id);

        if (bookingError || !bookingData || bookingData.length === 0) {
             if(bookingError) console.error('[resend-booking-info] Error fetching bookings:', bookingError.message);
             else console.log(`[resend-booking-info] No bookings found for customer ID ${customerData.id}. Sending no email.`);
             return genericSuccessResponse;
        }

        const bookingIds = bookingData.map(b => b.id);
        console.log(`[resend-booking-info] Found ${bookingIds.length} booking(s). Preparing to send email.`);
        
        if (!RESEND_API_KEY) {
            console.error("[resend-booking-info] FATAL: RESEND_API_KEY secret is not set.");
            return genericSuccessResponse;
        }
        
        // Fetch PDF attachment
        let pdfAttachment;
        try {
            console.log(`[resend-booking-info] Fetching PDF attachment from: ${PDF_ATTACHMENT_URL}`);
            const pdfResponse = await fetch(PDF_ATTACHMENT_URL);
            if (pdfResponse.ok) {
                const pdfArrayBuffer = await pdfResponse.arrayBuffer();
                const pdfBase64 = Buffer.from(pdfArrayBuffer).toString('base64');
                pdfAttachment = {
                    filename: 'Wichtige-Infos-zur-Anmeldung.pdf',
                    content: pdfBase64,
                };
                console.log("[resend-booking-info] Successfully fetched and encoded PDF attachment.");
            } else {
                console.warn(`[resend-booking-info] Failed to fetch PDF. Status: ${pdfResponse.status}. Email will be sent without attachment.`);
            }
        } catch (pdfError) {
            console.error("[resend-booking-info] Error fetching or processing PDF attachment:", pdfError.message);
        }

        let manageUrl = 'https://pfoten-event.vercel.app/?view=manage';
        // If there's only one booking, link to it directly for convenience.
        if (bookingIds.length === 1) {
            manageUrl += `&bookingId=${bookingIds[0]}`;
        }
        
        const htmlContent = createRecoveryEmailHtml(customerData.name, bookingIds, manageUrl);
        
        const emailPayload: any = {
            from: FROM_EMAIL,
            to: email,
            subject: "Deine angeforderten Buchungsnummern",
            html: htmlContent,
            reply_to: 'anmeldungen@pfotencard.hs-bw.com'
        };

        if (pdfAttachment) {
            emailPayload.attachments = [pdfAttachment];
        }

        console.log(`[resend-booking-info] Attempting to send recovery email to ${email} via Resend API.`);
        const resendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify(emailPayload),
        });
        
        if (!resendResponse.ok) {
            const responseData = await resendResponse.json();
            console.error("[resend-booking-info] Resend API Error:", responseData);
        } else {
             const responseData = await resendResponse.json();
             console.log("[resend-booking-info] Recovery email sent successfully via Resend:", responseData.id);
        }

        return genericSuccessResponse;

    } catch (error) {
        console.error("[resend-booking-info] Function Error:", error.message);
        return genericSuccessResponse;
    }
});