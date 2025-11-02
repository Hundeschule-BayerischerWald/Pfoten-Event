/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { render, h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

const html = htm.bind(h);

// --- SUPABASE KONFIGURATION ---
const supabaseUrl = 'https://wjlroiymmpvwaapboahh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqbHJvaXltbXB2d2FhcGJvYWhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NDExNDMsImV4cCI6MjA3NTUxNzE0M30.oRDURzRrudCmNAis4ZACxPsbWJwdxHt5Nw49phamZO4';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- TYPEN & INTERFACES ---
interface AppStatus {
    id: number;
    status: 'active' | 'cancelled';
    message: string | null;
    updated_at: string;
}

// --- API-SCHICHT (Supabase) ---
const api = {
    getAppStatus: async (): Promise<AppStatus | null> => {
        const { data, error } = await supabase.from('app_status').select('*').eq('id', 1).maybeSingle();
        if (error) {
            console.error('Widget: Error fetching app status:', error);
            return null;
        }
        return data;
    },
    subscribeToAppStatus: (callback: (newStatus: AppStatus) => void): RealtimeChannel => {
        const channel = supabase.channel('app_status_widget_changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'app_status', filter: 'id=eq.1' },
                (payload) => {
                    callback(payload.new as AppStatus);
                }
            )
            .subscribe((status, err) => {
                 if (err) {
                    console.error('Widget: Realtime subscription error:', err);
                }
            });
        return channel;
    },
};

// --- HELPER FUNKTIONEN ---
const formatStatusTime = (date: Date) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(date);

// --- KOMPONENTEN ---
const LiveStatusBanner = ({ statusData }) => {
    if (!statusData || !statusData.status) {
        return null; // Don't render anything if there's no data
    }

    const isCancelled = statusData.status === 'cancelled';
    const bannerClass = `status-banner ${isCancelled ? 'is-cancelled' : 'is-active'}`;
    const defaultMessage = isCancelled
        ? 'Alle Events sind zurzeit unterbrochen.'
        : 'Alle Events finden wie geplant statt.';

    const CheckIcon = () => html`
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="status-banner-icon">
            <path d="M20 6 9 17l-5-5"/>
        </svg>
    `;
    const CrossIcon = () => html`
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="status-banner-icon">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
    `;

    return html`
        <div class=${bannerClass} role="alert" aria-live="polite">
            ${isCancelled ? html`<${CrossIcon} />` : html`<${CheckIcon} />`}
            <div class="status-banner-content">
                <p class="status-banner-message">${statusData.message || defaultMessage}</p>
                <p class="status-banner-time">
                    Status aktualisiert um ${formatStatusTime(new Date(statusData.updated_at))} Uhr
                </p>
            </div>
        </div>
    `;
};


const Widget = () => {
    const [appStatus, setAppStatus] = useState<AppStatus | null>(null);

    useEffect(() => {
        // Fetch initial status and subscribe to realtime updates
        api.getAppStatus().then(setAppStatus);

        const channel = api.subscribeToAppStatus((newStatus) => {
            setAppStatus(newStatus);
        });

        // Cleanup subscription on component unmount
        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, []);

    return html`<${LiveStatusBanner} statusData=${appStatus} />`;
};

render(html`<${Widget} />`, document.getElementById('status-widget'));
