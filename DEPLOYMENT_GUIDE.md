# Deployment Guide - GitHub og Vercel

## Step 1: Opret nyt GitHub Repository

1. Gå til [github.com](https://github.com) og log ind
2. Klik på "+" i øverste højre hjørne → "New repository"
3. Navn: `sniksnak` (eller hvad du vil kalde det)
4. Beskrivelse: "Chatapp med forældrekontrol"
5. Vælg **Public** eller **Private** (som du foretrækker)
6. **VIGTIGT**: Check IKKE "Add a README file", "Add .gitignore", eller "Choose a license" (vi har allerede disse filer)
7. Klik "Create repository"

## Step 2: Fjern gammel remote og tilføj ny

Kør disse kommandoer i terminalen (fra projektmappen):

```bash
cd /Users/nikolajhygebjerg/Projects/ChatApp

# Fjern den gamle remote
git remote remove origin

# Tilføj den nye remote (erstatt USERNAME med dit GitHub brugernavn)
git remote add origin git@github.com:USERNAME/sniksnak.git

# Eller hvis du bruger HTTPS i stedet:
# git remote add origin https://github.com/USERNAME/sniksnak.git
```

## Step 3: Push kode til GitHub

```bash
# Tjek at alt er committet
git status

# Hvis der er ændringer, commit dem først:
# git add .
# git commit -m "Initial commit"

# Push til GitHub
git push -u origin main
```

Hvis du får fejl om SSH keys, kan du bruge HTTPS i stedet (se Step 2).

## Step 4: Opret Vercel Projekt

1. Gå til [vercel.com](https://vercel.com) og log ind (eller opret konto med GitHub)
2. Klik på "Add New..." → "Project"
3. Vælg dit nye repository (`sniksnak`)
4. Vercel vil automatisk detektere Next.js - klik "Deploy"

## Step 5: Konfigurer Environment Variables i Vercel

Efter første deployment:

1. Gå til dit projekt i Vercel dashboard
2. Klik på "Settings" → "Environment Variables"
3. Tilføj følgende variabler (fra din `.env.local.txt` fil):

### Påkrævede variabler:

```
NEXT_PUBLIC_SUPABASE_URL
https://utjssofvpvczqsoctiau.supabase.co

NEXT_PUBLIC_SUPABASE_ANON_KEY
sb_publishable_tP_pUIJZ-cPDFWUcot2l2w_VYgBUx6

SUPABASE_SERVICE_ROLE_KEY
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0anNzb2Z2cHZjenFzb2N0aWF1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTkyNzY5MiwiZXhwIjoyMDg1NTAzNjkyfQ.X65cf7clxvcWRKgnzycOf_iRigUGhUmbCbwVves8tM0
```

### Valgfrie variabler (hvis du bruger email):

```
RESEND_API_KEY
din-resend-api-key

RESEND_FROM_EMAIL
Chat App <notifications@yourdomain.com>
```

4. **VIGTIGT**: Efter første deployment, kopier din Vercel URL (fx `https://sniksnak-xyz.vercel.app`) og tilføj:

```
NEXT_PUBLIC_APP_URL
https://din-app-url.vercel.app
```

5. Vælg "Production", "Preview", og "Development" for alle variabler
6. Klik "Save"

## Step 6: Redeploy

1. Gå til "Deployments" i Vercel dashboard
2. Klik på de tre prikker ved siden af den seneste deployment
3. Vælg "Redeploy"
4. Vælg "Use existing Build Cache" og klik "Redeploy"

## Step 7: Opdater Supabase CORS (hvis nødvendigt)

Hvis din Supabase projekt har CORS beskyttelse:

1. Gå til Supabase Dashboard → Project Settings → API
2. Tilføj din Vercel URL til "Allowed Origins"
3. Format: `https://din-app-url.vercel.app`

## Troubleshooting

### Git push fejler
- Hvis SSH fejler, brug HTTPS i stedet
- Eller opsæt SSH keys: https://docs.github.com/en/authentication/connecting-to-github-with-ssh

### Vercel build fejler
- Tjek at alle environment variables er sat korrekt
- Tjek build logs i Vercel dashboard
- Sørg for at `package.json` har alle dependencies

### Supabase connection fejler
- Tjek at environment variables er sat korrekt i Vercel
- Tjek Supabase CORS settings
- Tjek Supabase project er aktivt
