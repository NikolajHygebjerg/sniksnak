# Push Notifikationer Setup

Denne guide forklarer hvordan man sætter op Web Push Notifikationer til chatappen, så brugere får notifikationer når de modtager nye beskeder, selv når appen ikke er åben.

## Krav

- Next.js app med Supabase
- HTTPS (krævet for push notifications - virker ikke på localhost uden HTTPS)
- Node.js server med adgang til at installere npm pakker

## Trin 1: Installer web-push pakken

```bash
npm install web-push
```

## Trin 2: Generer VAPID Keys

VAPID (Voluntary Application Server Identification) keys bruges til at autentificere din server overfor push services.

Generer VAPID keys ved at køre:

```bash
npx web-push generate-vapid-keys
```

Dette vil outputte noget som:
```
Public Key: BEl62iUYgUivxIkv69yViEuiBIa40HI9F8D...
Private Key: 8K1xTqbSPXxomMCkpr...
```

## Trin 3: Tilføj Environment Variables

Tilføj følgende til din `.env.local` fil:

```env
# VAPID Keys for Web Push Notifications
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa40HI9F8D...
VAPID_PRIVATE_KEY=8K1xTqbSPXxomMCkpr...
VAPID_EMAIL=mailto:your-email@example.com
```

**Vigtigt:**
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` skal være tilgængelig på client-side (derfor `NEXT_PUBLIC_` prefix)
- `VAPID_PRIVATE_KEY` skal KUN være på server-side (aldrig eksponeret til client)
- `VAPID_EMAIL` skal være en gyldig email eller `mailto:` URL

## Trin 4: Kør Database Migration

Kør migrationen for at oprette `push_subscriptions` tabellen:

```sql
-- Se supabase/migrations/025_create_push_subscriptions.sql
```

Eller kør den direkte i Supabase Dashboard → SQL Editor.

## Trin 5: Test Push Notifikationer

### 5.1. Test i Browser

1. Åbn appen i en browser der understøtter push notifications (Chrome, Firefox, Edge, Safari på macOS/iOS)
2. Log ind på appen
3. Når du logger ind første gang, vil browseren spørge om tilladelse til notifikationer
4. Klik "Tillad" eller "Allow"
5. Send en test besked fra en anden bruger til dig selv
6. Du skulle modtage en push notifikation, selv hvis appen ikke er åben

### 5.2. Verificer Service Worker

1. Åbn Developer Tools (F12)
2. Gå til "Application" tab (Chrome) eller "Storage" tab (Firefox)
3. Under "Service Workers" skulle du se `/sw.js` registreret
4. Under "Push" kan du se push subscriptions

## Hvordan det virker

1. **Service Worker** (`public/sw.js`): Håndterer push events og viser notifikationer
2. **Push Subscription**: Når brugeren tillader notifikationer, oprettes en subscription og gemmes i databasen
3. **Realtime Listener**: Når en ny besked kommer ind via Supabase Realtime, sendes en push notifikation
4. **Backend API** (`/api/push/send`): Sender faktiske push notifikationer til browseren

## Fejlfinding

### Notifikationer virker ikke

1. **Tjek HTTPS**: Push notifications kræver HTTPS (eller localhost)
2. **Tjek Browser Support**: Ikke alle browsere understøtter push notifications
3. **Tjek Tilladelse**: Gå til Browser Settings → Site Settings → Notifications og verificer at tilladelse er givet
4. **Tjek Console**: Åbn Developer Tools og tjek for fejl i Console
5. **Tjek Service Worker**: Verificer at service worker er registreret korrekt

### "VAPID keys not configured" fejl

- Tjek at alle VAPID environment variables er sat korrekt
- Genstart Next.js dev server efter at have tilføjet environment variables

### "No push subscriptions found" fejl

- Dette betyder at brugeren ikke har tilladt notifikationer endnu
- Prøv at logge ud og ind igen, og accepter notifikations-tilladelsen

## Sikkerhed

- VAPID private key skal ALDRIG eksponeres til client-side
- Push subscriptions er bundet til specifikke brugere via RLS (Row Level Security)
- Kun autentificerede brugere kan oprette/slette deres egne subscriptions

## Yderligere Ressourcer

- [Web Push Protocol](https://web.dev/push-notifications-overview/)
- [web-push npm pakke](https://www.npmjs.com/package/web-push)
- [Service Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
