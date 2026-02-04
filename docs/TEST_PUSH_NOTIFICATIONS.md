# Test Push Notifikationer

Nu hvor webhook'en er sat op i Supabase, kan du teste push notifications.

## Test Steps:

### 1. Verificer Webhook Setup i Supabase

Gå til Supabase Dashboard → Database → Webhooks og verificer:
- ✅ Table: `messages`
- ✅ Events: `INSERT`
- ✅ URL: `https://din-app.vercel.app/api/notify-message` (eller din API URL)
- ✅ HTTP Method: `POST`
- ✅ Status: Active

### 2. Test i Browser

1. **Åbn appen i en browser** (Chrome, Firefox, eller Safari)
2. **Log ind** som en bruger
3. **Accepter notifikations-tilladelsen** når browseren spørger
4. **Verificer service worker**:
   - Åbn Developer Tools (F12)
   - Gå til Application tab (Chrome) eller Storage tab (Firefox)
   - Under "Service Workers" skulle du se `/sw.js` registreret og aktiv
   - Under "Push" skulle du se en subscription

### 3. Test Push Notifikation

**Metode 1: Send en besked fra en anden bruger**
1. Log ind som Bruger A
2. Åbn appen i en anden browser/incognito som Bruger B
3. Send en besked fra Bruger B til Bruger A
4. Bruger A skulle modtage:
   - En push notifikation (hvis appen ikke er åben eller i baggrunden)
   - Badge tallet på chat ikonet opdateres automatisk

**Metode 2: Test med appen lukket**
1. Log ind som Bruger A
2. Accepter notifikations-tilladelsen
3. Luk browseren eller gå til en anden fane
4. Send en besked fra Bruger B til Bruger A
5. Bruger A skulle modtage en push notifikation

### 4. Verificer at Notifikationer Virker

**Tjek browser console:**
- Ingen fejlbeskeder
- "Push notifications initialized successfully" i console
- "Push notification received" i service worker console

**Tjek Network tab:**
- `/api/push/subscribe` kaldes og returnerer success
- `/api/notify-message` kaldes når beskeder indsættes (via webhook)
- `/api/push/send` kaldes fra notify-message endpoint

### 5. Troubleshooting

**Hvis notifikationer ikke kommer:**

1. **Tjek at webhook'en faktisk kaldes:**
   - Gå til Supabase Dashboard → Database → Webhooks
   - Klik på din webhook
   - Tjek "Recent Invocations" - skulle vise kald når beskeder indsættes

2. **Tjek server logs:**
   - Hvis du kører på Vercel, tjek Vercel logs
   - Se efter fejlbeskeder fra `/api/notify-message` eller `/api/push/send`

3. **Tjek VAPID keys:**
   - Verificer at `NEXT_PUBLIC_VAPID_PUBLIC_KEY` og `VAPID_PRIVATE_KEY` er sat korrekt
   - Genstart serveren efter at have tilføjet keys

4. **Tjek push subscriptions:**
   - I Supabase Dashboard → Table Editor → `push_subscriptions`
   - Verificer at der er rows for brugeren
   - Hvis ikke, prøv at logge ud og ind igen

5. **Test manuelt:**
   ```javascript
   // I browser console:
   navigator.serviceWorker.getRegistration('/').then(reg => {
     reg.pushManager.getSubscription().then(sub => {
       console.log('Subscription:', sub);
     });
   });
   ```

### 6. Forventet Adfærd

✅ **Når appen er åben og aktiv:**
- Badge tallet opdateres automatisk
- Ingen push notifikation (brugeren ser beskederne direkte)

✅ **Når appen er i baggrunden eller lukket:**
- Push notifikation vises
- Klik på notifikationen åbner appen og den relevante chat

✅ **Når brugeren ser den specifikke chat:**
- Ingen push notifikation (brugeren ser beskederne direkte)

## Noter:

- Push notifications virker på både **Mac og telefon** (Chrome, Firefox, Safari)
- På **Mac** kræver det HTTPS (eller localhost)
- På **iPhone/iPad** kræver det HTTPS (ikke localhost)
- Push notifications virker **kun når appen er lukket eller i baggrunden**

## Næste Skridt:

Hvis alt virker, er du klar! Push notifications sendes automatisk når:
1. En besked indsættes i databasen
2. Supabase webhook kalder `/api/notify-message`
3. `/api/notify-message` sender push notifikation via `/api/push/send`
4. Browseren viser notifikationen til brugeren
