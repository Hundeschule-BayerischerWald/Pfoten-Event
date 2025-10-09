/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { render, h } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// --- KONFIGURATION ---
const CANCELLATION_WINDOW_HOURS = 24; // Stornierungen/Änderungen nur bis 24h vor dem Event möglich

const EVENT_CATEGORIES = {
    "Orchid": { titles: ["Welpenstunde"], locations: ["Welpenwiese"] },
    "LimeGreen": { titles: ["L2 - Grundlagen"], locations: ["Der sichere Start"] },
    "SkyBlue": { titles: ["Tierische Eindrücke"], locations: ["Tierpark Straubing"] },
    "Peru": { titles: ["L4 - Treffpunkt"], locations: ["Bahnhof Mitterfels"] },
    "Gold": { titles: ["Trainerstunde"], locations: ["Nach Absprache"] },
    "White": { titles: ["Verbindlichkeit auf Distanz"], locations: ["Weites Feld"] },
    "DarkKhaki": { titles: ["Gelassenheitstraining"], locations: ["Stadtwald"] },
    "Tomato": { titles: ["Spezialkurs: Apportieren"], locations: ["Hundeschule Innenbereich"] }
};

// --- TYPEN & INTERFACES ---
interface Event {
    id: string;
    date: Date;
    title: string;
    location: string;
    totalCapacity: number;
    bookedCapacity: number;
    category: string;
}

interface Customer {
    name: string;
    phone: string;
    dogName: string;
    email: string;
}

interface Booking {
    bookingId: string;
    customer: Customer;
    bookedEventIds: string[];
}

// --- MOCK DATEN GENERATOR ---
const generateMockEvents = (): Event[] => {
    const events: Event[] = [];
    const today = new Date();
    const currentYear = today.getFullYear();
    const monthsToGenerate = [9, 10]; // 9 = Oktober, 10 = November

    const categoryKeys = Object.keys(EVENT_CATEGORIES);
    
    monthsToGenerate.forEach(monthIndex => {
        let dayInMonth = 1;
        
        categoryKeys.forEach(category => {
            const titleOptions = EVENT_CATEGORIES[category].titles;
            const locationOptions = EVENT_CATEGORIES[category].locations;
            const title = titleOptions[Math.floor(Math.random() * titleOptions.length)];
            const location = locationOptions[Math.floor(Math.random() * locationOptions.length)];

            // --- Create one bookable event for this category ---
            const totalCapacityBookable = 4 + Math.floor(Math.random() * 6);
            const bookedCapacityBookable = Math.floor(Math.random() * (totalCapacityBookable));
            const eventDateBookable = new Date(currentYear, monthIndex, dayInMonth);
            eventDateBookable.setHours(Math.random() > 0.5 ? 16 : 10, 0, 0, 0);

            events.push({
                id: `evt-bookable-${category}-${monthIndex}-${dayInMonth}`,
                date: eventDateBookable,
                title: title,
                location: location,
                totalCapacity: totalCapacityBookable,
                bookedCapacity: bookedCapacityBookable,
                category: category,
            });
            dayInMonth += 2; // Next available day

            // --- Create one fully booked event for this category ---
            const totalCapacityFull = 4 + Math.floor(Math.random() * 6);
            const eventDateFull = new Date(currentYear, monthIndex, dayInMonth);
            eventDateFull.setHours(Math.random() > 0.5 ? 17 : 11, 0, 0, 0);

            events.push({
                id: `evt-full-${category}-${monthIndex}-${dayInMonth}`,
                date: eventDateFull,
                title: title,
                location: location,
                totalCapacity: totalCapacityFull,
                bookedCapacity: totalCapacityFull,
                category: category,
            });
            dayInMonth += 2; // Next available day
        });
    });

    // Add one event in the past for testing
    const pastEventDate = new Date();
    pastEventDate.setDate(pastEventDate.getDate() - 2);
    events.push({
        id: `evt-past-test-1`,
        date: pastEventDate,
        title: "Vergangener Testkurs",
        location: "Archiv",
        totalCapacity: 5,
        bookedCapacity: 2,
        category: "Tomato",
    });

    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
};


// --- API SIMULATION (localStorage) ---
const api = {
    getEvents: (): Promise<Event[]> => {
        return new Promise(resolve => {
            let events = JSON.parse(localStorage.getItem('events') || 'null');
            if (!events) {
                events = generateMockEvents();
                localStorage.setItem('events', JSON.stringify(events, (key, value) => key === 'date' ? new Date(value).toISOString() : value));
            } else {
                 events = events.map(e => ({...e, date: new Date(e.date)}));
            }
            resolve(events);
        });
    },
    saveBooking: (customer: Customer, eventIds: string[]): Promise<Booking> => {
        return new Promise(async (resolve, reject) => {
            const allEvents = await api.getEvents();
            const bookings: Booking[] = JSON.parse(localStorage.getItem('bookings') || '[]');
            
            // Check for existing booking with the same email
            const existingBooking = bookings.find(b => b.customer.email.toLowerCase() === customer.email.toLowerCase());
            if (existingBooking) {
                return reject(new Error('Für diese E-Mail-Adresse existiert bereits eine Buchung. Bitte nutze die "Buchung verwalten"-Funktion, um Änderungen vorzunehmen.'));
            }

            for (const eventId of eventIds) {
                const event = allEvents.find(e => e.id === eventId);
                if (!event || event.bookedCapacity >= event.totalCapacity) {
                    return reject(new Error(`Event "${event?.title}" ist leider ausgebucht.`));
                }
            }
            
            const updatedEvents = allEvents.map(e => 
                eventIds.includes(e.id) ? { ...e, bookedCapacity: e.bookedCapacity + 1 } : e
            );
            
            const newBooking: Booking = {
                bookingId: `buchung-${Date.now()}`,
                customer,
                bookedEventIds: eventIds,
            };
            
            bookings.push(newBooking);
            
            localStorage.setItem('events', JSON.stringify(updatedEvents));
            localStorage.setItem('bookings', JSON.stringify(bookings));
            
            resolve(newBooking);
        });
    },
    getBookingById: (bookingId: string): Promise<Booking | null> => {
        return new Promise(resolve => {
            const bookings: Booking[] = JSON.parse(localStorage.getItem('bookings') || '[]');
            const foundBooking = bookings.find(b => b.bookingId === bookingId);
            resolve(foundBooking || null);
        });
    },
    updateBooking: (bookingId: string, newEventIds: string[]): Promise<Booking> => {
        return new Promise(async (resolve, reject) => {
            const allEvents = await api.getEvents();
            const bookings: Booking[] = JSON.parse(localStorage.getItem('bookings') || '[]');
            
            const bookingIndex = bookings.findIndex(b => b.bookingId === bookingId);
            if (bookingIndex === -1) {
                return reject(new Error('Buchung nicht gefunden.'));
            }

            const bookingToUpdate = bookings[bookingIndex];
            const originalEventIds = bookingToUpdate.bookedEventIds;

            const addedIds = newEventIds.filter(id => !originalEventIds.includes(id));
            const removedIds = originalEventIds.filter(id => !newEventIds.includes(id));

            const now = new Date();
            for (const removedId of removedIds) {
                const event = allEvents.find(e => e.id === removedId);
                if (event) {
                    const hoursUntilEvent = (new Date(event.date).getTime() - now.getTime()) / (1000 * 60 * 60);
                    if (hoursUntilEvent < CANCELLATION_WINDOW_HOURS) {
                        return reject(new Error(`Stornierung für "${event.title}" nicht möglich, da der Kurs in weniger als 24 Stunden beginnt.`));
                    }
                }
            }
             for (const addedId of addedIds) {
                const event = allEvents.find(e => e.id === addedId);
                if (!event || event.bookedCapacity >= event.totalCapacity) {
                    return reject(new Error(`Kurs "${event?.title}" ist leider ausgebucht.`));
                }
            }

            const updatedEvents = allEvents.map(event => {
                if (addedIds.includes(event.id)) {
                    return { ...event, bookedCapacity: event.bookedCapacity + 1 };
                }
                if (removedIds.includes(event.id)) {
                    // Make sure capacity doesn't go below 0
                    return { ...event, bookedCapacity: Math.max(0, event.bookedCapacity - 1) };
                }
                return event;
            });
            
            const updatedBooking = { ...bookingToUpdate, bookedEventIds: newEventIds };
            bookings[bookingIndex] = updatedBooking;

            localStorage.setItem('events', JSON.stringify(updatedEvents));
            localStorage.setItem('bookings', JSON.stringify(bookings));

            resolve(updatedBooking);
        });
    },
    addEvent: (newEventData: Omit<Event, 'id' | 'bookedCapacity' | 'date'> & { date: Date }): Promise<Event> => {
        return new Promise(async (resolve) => {
            const allEvents = await api.getEvents();
            const newEvent: Event = {
                ...newEventData,
                id: `evt-admin-${Date.now()}`,
                bookedCapacity: 0,
            };
            const updatedEvents = [...allEvents, newEvent];
            localStorage.setItem('events', JSON.stringify(updatedEvents));
            resolve(newEvent);
        });
    },
    updateEvent: (eventId: string, updatedEventData: Partial<Omit<Event, 'id'>>): Promise<Event> => {
        return new Promise(async (resolve, reject) => {
            const allEvents = await api.getEvents();
            let eventFound = false;
            const updatedEvents = allEvents.map(e => {
                if (e.id === eventId) {
                    eventFound = true;
                    return { ...e, ...updatedEventData, id: e.id };
                }
                return e;
            });
             if (!eventFound) {
                return reject(new Error('Event not found'));
            }
            localStorage.setItem('events', JSON.stringify(updatedEvents));
            resolve(updatedEvents.find(e => e.id === eventId)!);
        });
    },
    deleteEvent: (eventId: string): Promise<void> => {
        return new Promise(async (resolve) => {
            const allEvents = await api.getEvents();
            const updatedEvents = allEvents.filter(e => e.id !== eventId);
            localStorage.setItem('events', JSON.stringify(updatedEvents));
            resolve();
        });
    },
};

// --- HELPER FUNKTIONEN ---
const formatDate = (date: Date) => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short' }).format(date);
const formatTime = (date: Date) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(date) + ' Uhr';
const formatMonthYear = (date: Date) => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(date);
const getWeekNumber = (d: Date): number => {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return weekNo;
}
const toInputDateString = (date: Date) => date.toISOString().split('T')[0];
const toInputTimeString = (date: Date) => date.toTimeString().split(' ')[0].substring(0, 5);


// --- KOMPONENTEN ---

const EventItem = ({ event, onSelect, isSelected, isLocked }) => {
    const isFull = event.bookedCapacity >= event.totalCapacity;
    const remaining = event.totalCapacity - event.bookedCapacity;
    const isDisabled = isFull || isLocked;
    const categoryClass = `event-category-${event.category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    return html`
        <li class=${`event-item ${isDisabled ? 'disabled' : ''} ${categoryClass}`}>
             ${!isFull && !isLocked && html`<input 
                type="checkbox" 
                id=${event.id}
                checked=${isSelected}
                onChange=${() => onSelect(event.id)}
                disabled=${isDisabled}
                aria-label=${`Event ${event.title} auswählen`}
            />`}
            <label for=${isFull || isLocked ? null : event.id} class="event-details">
                <span>${formatDate(event.date)}. – ${formatTime(event.date)} – ${event.title} – ${event.location}</span>
            </label>
            <div class="event-capacity ${isFull ? 'capacity-full' : ''}">
                ${isLocked ? 'Vergangen' : isFull ? 'Leider Ausgebucht' : `${remaining} ${remaining === 1 ? 'Platz' : 'Plätze'} noch frei`}
            </div>
        </li>
    `;
};

const BookingPanel = ({ selectedEvents, customer, onCustomerChange, onSubmit, error, agreedAGB, onAgreedAGBChange, agreedPrivacy, onAgreedPrivacyChange }) => {
    if (selectedEvents.length === 0) {
        return html`
            <div class="booking-summary">
                <h3>Deine Auswahl</h3>
                <p class="empty-state">Wähle links einen oder mehrere Kurse aus, um mit der Anmeldung zu beginnen.</p>
            </div>
        `;
    }

    const handleInput = (e) => {
        onCustomerChange({ ...customer, [e.target.name]: e.target.value });
    };
    
    const showSubmitButton =
        customer.name.trim() !== '' &&
        customer.dogName.trim() !== '' &&
        customer.email.trim() !== '' &&
        customer.phone.trim() !== '' &&
        agreedAGB &&
        agreedPrivacy;

    return html`
        <div class="booking-panel">
            <div class="booking-form-container">
                 <form onSubmit=${onSubmit}>
                    <h3>Deine Anmeldung</h3>
                    
                    <ul class="selected-event-list">
                        ${selectedEvents.map(event => {
                            const categoryClass = `event-category-${event.category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                            return html`
                                <li key=${event.id} class=${`selected-event-item ${categoryClass}`}>
                                    <span>${event.title}</span>
                                    <span class="selected-event-time">${formatDate(event.date)}</span>
                                </li>
                            `
                        })}
                    </ul>

                    <p class="legal-notice">Hiermit melde ich mich rechtsverbindlich für die von mir ausgewählten Unterrichts-Stunden an.</p>
                    <div class="form-group">
                        <label for="name">Name</label>
                        <input type="text" id="name" name="name" value=${customer.name} onInput=${handleInput} required />
                    </div>
                    <div class="form-group">
                        <label for="dogName">Name des Hundes</label>
                        <input type="text" id="dogName" name="dogName" value=${customer.dogName} onInput=${handleInput} required />
                    </div>
                     <div class="form-group">
                        <label for="email">E-Mail</label>
                        <input type="email" id="email" name="email" value=${customer.email} onInput=${handleInput} required />
                    </div>
                    <div class="form-group">
                        <label for="phone">Telefon</label>
                        <input type="tel" id="phone" name="phone" value=${customer.phone} onInput=${handleInput} required />
                    </div>
                    
                    <div class="form-group-checkbox">
                        <input type="checkbox" id="agb" name="agb" checked=${agreedAGB} onChange=${e => onAgreedAGBChange(e.target.checked)} required />
                        <label for="agb">Ich habe die <a href="#">AGB's</a> gelesen und akzeptiere sie.</label>
                    </div>
                    <div class="form-group-checkbox">
                        <input type="checkbox" id="privacy" name="privacy" checked=${agreedPrivacy} onChange=${e => onAgreedPrivacyChange(e.target.checked)} required />
                        <label for="privacy">Ich habe die <a href="#">Datenschutzerklärung</a> gelesen und akzeptiere sie.</label>
                    </div>

                    ${error && html`<p class="error-message">${error}</p>`}
                    
                    ${showSubmitButton ? html`
                        <button type="submit" class="btn btn-primary">
                          Rechtsverbindlich anmelden
                        </button>
                    ` : html`
                        <p class="form-hint">Bitte fülle alle Felder aus und akzeptiere die Bedingungen, um die Anmeldung abzuschließen.</p>
                    `}
                 </form>
            </div>
        </div>
    `;
}

const SuccessModal = ({ bookingDetails, onClose }) => {
    if (!bookingDetails) return null;

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content" onClick=${e => e.stopPropagation()}>
                <div class="modal-header">
                    <h2>Buchung erfolgreich!</h2>
                    <button class="modal-close-btn" onClick=${onClose} aria-label="Schließen">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Vielen Dank, ${bookingDetails.customerName}!</p>
                    <p>Deine Anmeldung war erfolgreich. Wir haben dir eine Bestätigung per E-Mail gesendet (simuliert).</p>
                    <p class="booking-id">Deine Buchungsnummer lautet: <strong>${bookingDetails.bookingId}</strong></p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onClick=${onClose}>Schließen</button>
                </div>
            </div>
        </div>
    `;
};

const EventFormModal = ({ event, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        title: '',
        location: '',
        date: '',
        time: '',
        totalCapacity: 5,
        category: Object.keys(EVENT_CATEGORIES)[0],
    });

    useEffect(() => {
        if (event) {
            setFormData({
                title: event.title,
                location: event.location,
                date: toInputDateString(event.date),
                time: toInputTimeString(event.date),
                totalCapacity: event.totalCapacity,
                category: event.category,
            });
        } else {
             setFormData({
                title: '',
                location: '',
                date: toInputDateString(new Date()),
                time: '10:00',
                totalCapacity: 5,
                category: Object.keys(EVENT_CATEGORIES)[0],
            });
        }
    }, [event]);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const combinedDate = new Date(`${formData.date}T${formData.time}`);
        const eventData = {
            title: formData.title,
            location: formData.location,
            date: combinedDate,
            totalCapacity: Number(formData.totalCapacity),
            category: formData.category,
        };
        onSave(eventData);
    };
    
    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content" onClick=${e => e.stopPropagation()}>
                <form onSubmit=${handleSubmit}>
                    <div class="modal-header">
                        <h2>${event ? 'Event bearbeiten' : 'Neues Event erstellen'}</h2>
                        <button type="button" class="modal-close-btn" onClick=${onClose} aria-label="Schließen">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="title">Titel</label>
                            <input type="text" id="title" name="title" value=${formData.title} onInput=${handleChange} required />
                        </div>
                         <div class="form-group">
                            <label for="location">Treffpunkt</label>
                            <input type="text" id="location" name="location" value=${formData.location} onInput=${handleChange} required />
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="date">Datum</label>
                                <input type="date" id="date" name="date" value=${formData.date} onInput=${handleChange} required />
                            </div>
                            <div class="form-group">
                                <label for="time">Uhrzeit</label>
                                <input type="time" id="time" name="time" value=${formData.time} onInput=${handleChange} required />
                            </div>
                        </div>
                         <div class="form-row">
                            <div class="form-group">
                                <label for="totalCapacity">Plätze</label>
                                <input type="number" id="totalCapacity" name="totalCapacity" min="1" value=${formData.totalCapacity} onInput=${handleChange} required />
                            </div>
                            <div class="form-group">
                                <label for="category">Kategorie</label>
                                <select id="category" name="category" value=${formData.category} onChange=${handleChange}>
                                    ${Object.keys(EVENT_CATEGORIES).map(cat => html`<option value=${cat}>${cat}</option>`)}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                         <button type="button" class="btn btn-secondary" onClick=${onClose}>Abbrechen</button>
                         <button type="submit" class="btn btn-primary">Speichern</button>
                    </div>
                </form>
            </div>
        </div>
    `;
};

const AdminPanel = () => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState(null);

    const loadEvents = async () => {
        setLoading(true);
        const eventsFromApi = await api.getEvents();
        const now = new Date();
        const futureEvents = eventsFromApi.filter(e => e.date >= now);
        setEvents(futureEvents.sort((a, b) => a.date.getTime() - b.date.getTime()));
        setLoading(false);
    };

    useEffect(() => {
        loadEvents();
    }, []);

    const handleAdd = () => {
        setEditingEvent(null);
        setIsModalOpen(true);
    };

    const handleEdit = (event) => {
        setEditingEvent(event);
        setIsModalOpen(true);
    };

    const handleDelete = async (eventId) => {
        if (confirm('Bist du sicher, dass du dieses Event löschen möchtest?')) {
            await api.deleteEvent(eventId);
            loadEvents();
        }
    };
    
    const handleSave = async (eventData) => {
        if (editingEvent) {
            await api.updateEvent(editingEvent.id, eventData);
        } else {
            await api.addEvent(eventData);
        }
        setIsModalOpen(false);
        setEditingEvent(null);
        loadEvents();
    };

    if (loading) {
        return html`<div class="loading-state">Lade Events für Admin Panel...</div>`;
    }

    return html`
        <section class="admin-panel">
            <div class="admin-header">
                <h2>Event Verwaltung</h2>
                <button class="btn btn-primary" onClick=${handleAdd}>+ Neues Event</button>
            </div>
            <ul class="admin-event-list">
                ${events.map(event => html`
                    <li key=${event.id} class=${`admin-event-item event-category-${event.category.toLowerCase()}`}>
                       <div class="admin-event-info">
                            <strong>${event.title}</strong>
                            <span>${formatDate(event.date)} - ${formatTime(event.date)}</span>
                            <span>Treffpunkt: ${event.location}</span>
                            <span>Plätze: ${event.bookedCapacity} / ${event.totalCapacity}</span>
                       </div>
                       <div class="admin-event-actions">
                           <button class="btn btn-secondary" onClick=${() => handleEdit(event)}>Bearbeiten</button>
                           <button class="btn btn-danger" onClick=${() => handleDelete(event.id)}>Löschen</button>
                       </div>
                    </li>
                `)}
            </ul>
        </section>
        ${isModalOpen && html`
            <${EventFormModal} 
                event=${editingEvent}
                onSave=${handleSave}
                onClose=${() => setIsModalOpen(false)}
            />
        `}
    `;
};

const BookingManagementPortal = () => {
    const [bookingIdInput, setBookingIdInput] = useState('');
    const [booking, setBooking] = useState<Booking | null>(null);
    const [allEvents, setAllEvents] = useState<Event[]>([]);
    const [managedEventIds, setManagedEventIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (booking) {
            setIsLoading(true);
            api.getEvents().then(events => {
                setAllEvents(events);
                setIsLoading(false);
            });
        }
    }, [booking]);

    useEffect(() => {
        if (booking) {
            setHasChanges(JSON.stringify(booking.bookedEventIds.sort()) !== JSON.stringify(managedEventIds.sort()));
        } else {
            setHasChanges(false);
        }
    }, [managedEventIds, booking]);

    const handleLookup = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setIsLoading(true);
        setBooking(null);
        try {
            const foundBooking = await api.getBookingById(bookingIdInput.trim());
            if (foundBooking) {
                setBooking(foundBooking);
                setManagedEventIds(foundBooking.bookedEventIds);
            } else {
                setError('Buchung nicht gefunden. Bitte überprüfe die Buchungsnummer.');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveChanges = async () => {
        if (!booking) return;
        setError('');
        setSuccessMessage('');
        setIsLoading(true);
        try {
            const updatedBooking = await api.updateBooking(booking.bookingId, managedEventIds);
            setBooking(updatedBooking); // update local state with the saved data
            setManagedEventIds(updatedBooking.bookedEventIds);
            setSuccessMessage('Deine Buchung wurde erfolgreich aktualisiert!');
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEventToggle = (eventId: string) => {
        setManagedEventIds(prev =>
            prev.includes(eventId) ? prev.filter(id => id !== eventId) : [...prev, eventId]
        );
    };

    const { bookedEvents, availableEvents } = useMemo(() => {
        if (!booking) return { bookedEvents: [], availableEvents: [] };
        const now = new Date();
        const booked = allEvents
            .filter(e => managedEventIds.includes(e.id) && e.date >= now)
            .sort((a, b) => a.date.getTime() - b.date.getTime());

        const available = allEvents
            .filter(e => {
                if (managedEventIds.includes(e.id)) return false; // Already in selection
                if (e.date < now) return false; // In the past
                if (e.bookedCapacity >= e.totalCapacity) return false; // Full
                return true;
            })
            .sort((a, b) => a.date.getTime() - b.date.getTime());
        return { bookedEvents: booked, availableEvents: available };
    }, [allEvents, managedEventIds, booking]);

    if (!booking) {
        return html`
            <section class="booking-lookup-form">
                <form onSubmit=${handleLookup}>
                    <h2>Buchung verwalten</h2>
                    <p>Gib deine Buchungsnummer ein, um deine Termine zu bearbeiten.</p>
                    <div class="form-group">
                        <label for="bookingId">Buchungsnummer</label>
                        <input type="text" id="bookingId" name="bookingId" value=${bookingIdInput} onInput=${e => setBookingIdInput(e.target.value)} required placeholder="z.B. buchung-1234567890" />
                    </div>
                    ${error && html`<p class="error-message">${error}</p>`}
                    <button type="submit" class="btn btn-primary" disabled=${isLoading}>
                        ${isLoading ? 'Sucht...' : 'Buchung suchen'}
                    </button>
                </form>
            </section>
        `;
    }

    return html`
       <section class="manage-portal">
            <h2>Buchungsübersicht für ${booking.customer.name}</h2>
            <p>Buchungsnummer: <strong>${booking.bookingId}</strong></p>

            ${error && html`<p class="error-message">${error}</p>`}
            ${successMessage && html`<p class="success-message">${successMessage}</p>`}

            <div class="manage-container">
                <div class="manage-section">
                    <h3>Deine gebuchten Kurse</h3>
                    ${bookedEvents.length > 0 ? html`
                        <ul class="manage-event-list">
                            ${bookedEvents.map(event => {
                                const hoursUntil = (event.date.getTime() - new Date().getTime()) / (1000 * 60 * 60);
                                const canCancel = hoursUntil >= CANCELLATION_WINDOW_HOURS;
                                const categoryClass = `event-category-${event.category.toLowerCase()}`;
                                return html`
                                    <li key=${event.id} class=${`manage-event-item ${categoryClass}`}>
                                        <div class="manage-event-details">
                                            <strong>${event.title}</strong>
                                            <span>${formatDate(event.date)} - ${formatTime(event.date)}</span>
                                            ${!canCancel && html`<small class="cancel-warning">Stornierung nicht mehr möglich</small>`}
                                        </div>
                                        <button class="btn btn-danger" onClick=${() => handleEventToggle(event.id)} disabled=${!canCancel}>Stornieren</button>
                                    </li>
                                `;
                            })}
                        </ul>
                    ` : html`<p class="empty-state-small">Du hast aktuell keine Kurse gebucht.</p>`}
                </div>
                <div class="manage-section">
                    <h3>Verfügbare Kurse</h3>
                     ${availableEvents.length > 0 ? html`
                        <ul class="manage-event-list">
                            ${availableEvents.map(event => {
                                const categoryClass = `event-category-${event.category.toLowerCase()}`;
                                return html`
                                     <li key=${event.id} class=${`manage-event-item ${categoryClass}`}>
                                        <div class="manage-event-details">
                                            <strong>${event.title}</strong>
                                            <span>${formatDate(event.date)} - ${formatTime(event.date)}</span>
                                            <small>${event.totalCapacity - event.bookedCapacity} Plätze frei</small>
                                        </div>
                                        <button class="btn btn-success" onClick=${() => handleEventToggle(event.id)}>Buchen</button>
                                    </li>
                                `;
                            })}
                        </ul>
                    ` : html`<p class="empty-state-small">Aktuell sind keine weiteren Kurse verfügbar.</p>`}
                </div>
            </div>
            <div class="manage-footer">
                <button class="btn btn-secondary" onClick=${() => setBooking(null)}>Andere Buchung suchen</button>
                <button class="btn btn-primary" onClick=${handleSaveChanges} disabled=${!hasChanges || isLoading}>
                    ${isLoading ? 'Speichert...' : 'Änderungen speichern'}
                </button>
            </div>
       </section>
    `;
};


const CustomerBookingView = () => {
    const [allEvents, setAllEvents] = useState<Event[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
    const [customer, setCustomer] = useState<Customer>({ name: '', phone: '', dogName: '', email: '' });
    const [bookingError, setBookingError] = useState('');
    const [agreedAGB, setAgreedAGB] = useState(false);
    const [agreedPrivacy, setAgreedPrivacy] = useState(false);
    const [bookingSuccess, setBookingSuccess] = useState(false);
    const [successfulBookingDetails, setSuccessfulBookingDetails] = useState(null);

    const loadInitialData = async () => {
        setLoading(true);
        const events = await api.getEvents();
        setAllEvents(events);
        setLoading(false);
    };

    useEffect(() => {
        loadInitialData();
    }, []);

    const handleSelectEvent = (eventId: string) => {
        setSelectedEventIds(prev =>
            prev.includes(eventId) ? prev.filter(id => id !== eventId) : [...prev, eventId]
        );
    };
    
    const handleCloseModal = () => {
        setBookingSuccess(false);
        setSuccessfulBookingDetails(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBookingError('');
        try {
            const booking = await api.saveBooking(customer, selectedEventIds);
            setSuccessfulBookingDetails({ bookingId: booking.bookingId, customerName: customer.name });
            setBookingSuccess(true);
            
            // Reset state after successful booking
            setSelectedEventIds([]);
            setCustomer({ name: '', phone: '', dogName: '', email: '' });
            setAgreedAGB(false);
            setAgreedPrivacy(false);
            
            // Reload events to show updated capacity
            loadInitialData();

        } catch (err) {
            setBookingError(err.message);
        }
    }
    
    const { eventsByWeek, selectedEvents } = useMemo(() => {
        const now = new Date();
        const futureEvents = allEvents
            .filter(event => event.date >= now)
            .sort((a, b) => a.date.getTime() - b.date.getTime());

        const groupedByWeek = futureEvents.reduce((acc, event) => {
            const week = getWeekNumber(event.date);
            const year = event.date.getFullYear();
            const key = `${year}-${String(week).padStart(2, '0')}`;

            if (!acc[key]) {
                acc[key] = { events: [] };
            }
            acc[key].events.push(event);
            return acc;
        }, {});

        const sortedKeys = Object.keys(groupedByWeek).sort();

        const eventsByWeek = sortedKeys.map(key => {
            const group = groupedByWeek[key];
            const firstEventDate = group.events[0].date;
            const weekNumber = getWeekNumber(firstEventDate);
            return {
                weekHeader: `${formatMonthYear(firstEventDate)} - Kalenderwoche ${weekNumber}`,
                events: group.events
            };
        });
        
        const selectedEvents = allEvents.filter(event => selectedEventIds.includes(event.id)).sort((a,b) => a.date.getTime() - b.date.getTime());
            
        return { eventsByWeek, selectedEvents };
    }, [allEvents, selectedEventIds]);

    if (loading) {
        return html`<div class="loading-state">Lade Kurstermine...</div>`;
    }
    
    const now = new Date();
    
    return html`
        <main class="main-container">
            <section class="events-section">
                <div class="month-navigator">
                    <h2>Eventliste Hundeschule</h2>
                </div>
                <div class="event-list-container">
                    ${eventsByWeek.length > 0 ? eventsByWeek.map(weekGroup => html`
                        <div class="week-group" key=${weekGroup.weekHeader}>
                            <h3 class="week-header">${weekGroup.weekHeader}</h3>
                            <ul class="event-list">
                                ${weekGroup.events.map(event => {
                                    const isPast = event.date < now;
                                    return html`
                                    <${EventItem} 
                                        key=${event.id}
                                        event=${event}
                                        onSelect=${handleSelectEvent}
                                        isSelected=${selectedEventIds.includes(event.id)}
                                        isLocked=${isPast}
                                    />
                                `})}
                            </ul>
                        </div>
                    `) : html`
                        <p class="empty-state">In diesem Monat gibt es keine verfügbaren Events.</p>
                    `}
                </div>
            </section>
            
            <aside class="booking-section">
                <${BookingPanel} 
                    selectedEvents=${selectedEvents}
                    customer=${customer}
                    onCustomerChange=${setCustomer}
                    onSubmit=${handleSubmit}
                    error=${bookingError}
                    agreedAGB=${agreedAGB}
                    onAgreedAGBChange=${setAgreedAGB}
                    agreedPrivacy=${agreedPrivacy}
                    onAgreedPrivacyChange=${setAgreedPrivacy}
                />
            </aside>
        </main>
        ${bookingSuccess && html`
            <${SuccessModal} 
                bookingDetails=${successfulBookingDetails}
                onClose=${handleCloseModal}
            />
        `}
    `;
};

const AdminLoginModal = ({ onLogin, onClose }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');
        const success = onLogin(email, password);
        if (!success) {
            setError('Falsche E-Mail-Adresse oder Passwort.');
        }
    };

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content" onClick=${e => e.stopPropagation()}>
                <form onSubmit=${handleSubmit}>
                    <div class="modal-header">
                        <h2>Admin Login</h2>
                        <button type="button" class="modal-close-btn" onClick=${onClose} aria-label="Schließen">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="admin-email">E-Mail</label>
                            <input type="email" id="admin-email" name="email" value=${email} onInput=${e => setEmail(e.target.value)} required autocomplete="email" />
                        </div>
                        <div class="form-group">
                            <label for="admin-password">Passwort</label>
                            <input type="password" id="admin-password" name="password" value=${password} onInput=${e => setPassword(e.target.value)} required autocomplete="current-password" />
                        </div>
                        ${error && html`<p class="error-message">${error}</p>`}
                    </div>
                    <div class="modal-footer">
                         <button type="button" class="btn btn-secondary" onClick=${onClose}>Abbrechen</button>
                         <button type="submit" class="btn btn-primary">Login</button>
                    </div>
                </form>
            </div>
        </div>
    `;
};


const App = () => {
    const [view, setView] = useState('booking');
    const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

    const handleLoginAttempt = (email, password) => {
        if (email.toLowerCase() === 'info@hs-bw.com' && password === 'poker128') {
            setIsAdminAuthenticated(true);
            setIsLoginModalOpen(false);
            setView('admin');
            return true;
        }
        return false;
    };

    const handleLogout = () => {
        setIsAdminAuthenticated(false);
        setView('booking');
    };

    return html`
        <header class="booking-tool-header">
            <h1>Kursanmeldung Hundeschule</h1>
            <p>Wähle deine Wunschtermine, verwalte deine Buchung oder greife auf das Admin-Panel zu.</p>
            <nav class="main-nav">
                <button class=${`btn ${view === 'booking' ? 'btn-primary' : 'btn-secondary'}`} onClick=${() => setView('booking')}>Kurs buchen</button>
                <button class=${`btn ${view === 'manage' ? 'btn-primary' : 'btn-secondary'}`} onClick=${() => setView('manage')}>Buchung verwalten</button>
                ${isAdminAuthenticated && html`
                    <button class=${`btn ${view === 'admin' ? 'btn-primary' : 'btn-secondary'}`} onClick=${() => setView('admin')}>Admin Panel</button>
                    <button class="btn btn-secondary" onClick=${handleLogout}>Logout</button>
                `}
            </nav>
        </header>

        <main>
            ${view === 'booking' && html`<${CustomerBookingView} />`}
            ${isAdminAuthenticated && view === 'admin' && html`<${AdminPanel} />`}
            ${view === 'manage' && html`<${BookingManagementPortal} />`}
        </main>
        
        ${!isAdminAuthenticated && html`
            <footer class="app-footer">
                <button class="admin-login-btn" onClick=${() => setIsLoginModalOpen(true)}>Admin Login</button>
            </footer>
        `}

        ${isLoginModalOpen && html`
            <${AdminLoginModal} 
                onLogin=${handleLoginAttempt}
                onClose=${() => setIsLoginModalOpen(false)}
            />
        `}
    `;
};


render(html`<${App} />`, document.getElementById('app'));