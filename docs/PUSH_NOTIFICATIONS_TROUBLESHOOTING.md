# Push Notifikationer - Fejlfinding

## Fejl: "NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set"

Denne fejl opstår når VAPID public key ikke er konfigureret korrekt.

### Løsning:

1. **Generer VAPID keys** (hvis du ikke har gjort det endnu):
   ```bash
   npx web-push generate-vapid-keys
   ```

2. **Tilføj environment variables til `.env.local`**:
   ```env
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa40HI9F8D...
   VAPID_PRIVATE_KEY=8K1xTqbSPXxomMCkpr...
   VAPID_EMAIL=mailto:your-email@example.com
   ```

3. **Genstart Next.js dev server**:
   - Stop serveren (Ctrl+C)
   - Start den igen (`npm run dev`)
   
   **Vigtigt:** Next.js indlæser kun environment variables ved start. Du skal genstarte serveren efter at have tilføjet nye variabler.

4. **Verificer at variablen er sat**:
   - Tjek at `.env.local` filen findes i projektets rod
   - Tjek at variablen starter med `NEXT_PUBLIC_` (krævet for client-side access)
   - Tjek at der ikke er mellemrum eller anførselstegn omkring værdien

### Eksempel `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Push Notifications
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa40HI9F8D...
VAPID_PRIVATE_KEY=8K1xTqbSPXxomMCkpr...
VAPID_EMAIL=mailto:admin@example.com
```

---

## Fejl: "Push subscription failed: AbortError: Registration failed - push service error"

Denne fejl opstår når browseren ikke kan registrere push subscription. Dette kan skyldes flere ting:

### Mulige årsager og løsninger:

#### 1. Service Worker er ikke aktiv
**Løsning:** 
- Vent et par sekunder efter at have accepteret notifikations-tilladelsen
- Genindlæs siden (F5)
- Tjek i Developer Tools → Application → Service Workers at service worker er aktiv

#### 2. VAPID key format er forkert
**Løsning:**
- Verificer at VAPID public key er korrekt kopieret (ingen mellemrum eller linjeskift)
- Prøv at generere nye keys:
  ```bash
  npx web-push generate-vapid-keys
  ```

#### 3. Browser understøtter ikke push notifications
**Løsning:**
- Push notifications virker kun i moderne browsere (Chrome, Firefox, Edge, Safari på macOS/iOS)
- Tjek at du ikke er i incognito/private mode (nogle browsere deaktiverer push i incognito)
- Tjek at browseren er opdateret

#### 4. HTTPS krav
**Løsning:**
- Push notifications kræver HTTPS (eller localhost)
- Hvis du tester på production, sikr dig at du bruger HTTPS
- På localhost skulle det virke uden HTTPS

#### 5. Service Worker scope problemer
**Løsning:**
- Tjek at `sw.js` filen er i `public/` mappen
- Verificer at service worker kan tilgås på `/sw.js`
- Tjek browser console for service worker fejl

### Debugging steps:

1. **Åbn Developer Tools** (F12)
2. **Gå til Console tab** - tjek for fejlbeskeder
3. **Gå til Application tab** (Chrome) eller **Storage tab** (Firefox):
   - Under "Service Workers" - verificer at service worker er registreret og aktiv
   - Under "Push" - tjek om der er nogen subscriptions
4. **Tjek Network tab** - se om `/sw.js` loader korrekt (status 200)

### Test manuelt:

1. Åbn browser console
2. Kør:
   ```javascript
   navigator.serviceWorker.getRegistration('/').then(reg => {
     console.log('Service Worker:', reg);
     if (reg) {
       reg.pushManager.getSubscription().then(sub => {
         console.log('Subscription:', sub);
       });
     }
   });
   ```

### Hvis fejlen fortsætter:

1. **Prøv at unsubscribe og subscribe igen:**
   - I browser console:
     ```javascript
     navigator.serviceWorker.getRegistration('/').then(reg => {
       reg.pushManager.getSubscription().then(sub => {
         if (sub) sub.unsubscribe();
       });
     });
     ```
   - Genindlæs siden og prøv igen

2. **Ryd browser cache:**
   - Developer Tools → Application → Clear storage → Clear site data
   - Genindlæs siden

3. **Prøv en anden browser:**
   - Test i Chrome, Firefox eller Edge for at se om problemet er browser-specifikt

### Bemærk:

- Push notifications er **valgfri** - appen virker fint uden dem
- Hvis du ikke vil bruge push notifications, kan du ignorere denne fejl
- Fejlen vises kun i console og påvirker ikke appens funktionalitet
