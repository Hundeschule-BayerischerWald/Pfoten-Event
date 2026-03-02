import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import { supabase } from "./supabaseClient";
import "./index.css";

const html = htm.bind(require("preact").h);

function App() {
  const [view, setView] = useState("booking");
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return html`
    <div class="app-root">
      ${view === "booking" && html`<div class="view">Booking-Ansicht</div>`}
      ${view === "manage" && html`<div class="view">Buchung verwalten</div>`}
      ${view === "admin" && session && html`<div class="view">Admin-Bereich</div>`}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app")!);
