# Push Notifikationer - Kendte Problemer

## Fejl: "AbortError: Registration failed - push service error"

Denne fejl kan opstå af flere årsager. Push notifications er **valgfri** - appen virker fint uden dem. Badge-tallet vil stadig virke korrekt.

### Mulige årsager:

1. **Browser understøtter ikke push notifications korrekt**
   - Nogle browsere har begrænsninger eller bugs
   - Prøv en anden browser (Chrome, Firefox, Edge)

2. **Service Worker timing issues**
   - Browseren kan have problemer med at aktivere service worker
   - Prøv at genindlæse siden flere gange

3. **VAPID key format**
   - Selvom key'en ser korrekt ud, kan browseren have problemer med den
   - Prøv at generere nye keys

4. **Browser settings**
   - Nogle browsere blokerer push notifications i visse situationer
   - Tjek browser settings → Notifications

### Løsninger:

#### 1. Ignorer fejlen (anbefalet)
Push notifications er valgfri. Badge-tallet og realtime updates virker stadig perfekt. Appen fungerer fint uden push notifications.

#### 2. Prøv en anden browser
- Chrome (anbefalet)
- Firefox
- Edge
- Safari (kun på macOS/iOS med HTTPS)

#### 3. Ryd browser cache
- Developer Tools → Application → Clear storage → Clear site data
- Genindlæs siden

#### 4. Tjek browser console
- Se om der er andre fejlbeskeder der kan hjælpe
- Tjek Network tab for at se om `/sw.js` loader korrekt

### Vigtigt:

**Push notifications er IKKE påkrævet for appen at fungere.** 

- ✅ Badge-tallet virker stadig perfekt
- ✅ Realtime updates virker stadig
- ✅ Chat funktionalitet virker stadig
- ❌ Du får bare ikke push notifikationer når appen er lukket

Dette er en kendt begrænsning i nogle browsere og kan ikke altid fixes. Appen er designet til at virke perfekt uden push notifications.
