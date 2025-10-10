// supabase/functions/resend-booking-info/index.ts

// WICHTIG: Diese Funktion wurde umgestellt, um Resend (resend.com) anstelle von direktem SMTP zu verwenden.
// Direkter SMTP-Versand aus Supabase Edge Functions ist aufgrund von Netzwerk-Einschränkungen unzuverlässig.

// 1. Erstelle einen kostenlosen Account auf resend.com
// 2. Erstelle einen API-Schlüssel.
// 3. Füge den API-Schlüssel als Secret in deinem Supabase-Projekt hinzu:
//    Name: RESEND_API_KEY, Wert: re_...
// 4. VERIFIZIERE DEINE DOMAIN (z.B. hs-bw.com) IN DEINEM RESEND ACCOUNT.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fix for "Cannot find name 'Deno'" error in non-Deno environments.
declare const Deno: any;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// HINWEIS: Um von deiner eigenen Domain zu senden, musst du sie in Resend verifizieren.
const FROM_EMAIL = 'Hundeschule <anmeldungen@pfotencard.hs-bw.com>';

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
        <div style="text-align: center; margin: 25px 0;">
          <a href="http://pfotencard.hs-bw.com/?view=manage" target="_blank" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Zur Buchungsverwaltung
          </a>
        </div>
        <p style="margin-top: 20px; font-size: 12px; color: #888; text-align: center;">
          Dies ist eine automatisch generierte E-Mail. Bitte antworte nicht darauf.
        </p></div></body></html>
    `;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }});
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
        
        const htmlContent = createRecoveryEmailHtml(customerData.name, bookingIds);
        
        console.log(`[resend-booking-info] Attempting to send recovery email to ${email} via Resend API.`);
        
        const resendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
                from: FROM_EMAIL,
                to: email,
                subject: "Deine angeforderten Buchungsnummern",
                html: htmlContent,
                reply_to: 'anmeldungen@pfotencard.hs-bw.com'
            }),
        });
        
        if (!resendResponse.ok) {
            const responseData = await resendResponse.json();
            console.error("[resend-booking-info] Resend API Error:", responseData);
            // Don't throw, just log and return generic success.
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