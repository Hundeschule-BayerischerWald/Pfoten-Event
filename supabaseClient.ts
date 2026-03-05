import { createClient } from '@supabase/supabase-js';

// --- SUPABASE ZUGANGSDATEN ---
// Diese Datei dient als zentraler Speicherort für die Datenbankverbindung.
// Durch die Auslagerung kann der KI untersagt werden, diese Datei zu bearbeiten.
const supabaseUrl = 'https://wjlroiymmpvwaapboahh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqbHJvaXltbXB2d2FhcGJvYWhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NDExNDMsImV4cCI6MjA3NTUxNzE0M30.oRDURzRrudCmNAis4ZACxPsbWJwdxHt5Nw49phamZO4';

export const supabase = createClient(supabaseUrl, supabaseKey);
