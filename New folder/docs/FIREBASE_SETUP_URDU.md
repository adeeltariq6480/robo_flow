# Firebase Setup — Label AI

## Important

**Firebase account sirf aap bana sakte ho** — Google login zaroori hai.  
AI / script aapke naam se Firebase project **create nahi** kar sakta.

Lekin **bina account ke local test** possible hai → Firebase Emulators.

---

## Option 1: Local test (5 minute, no Google account)

```bash
npm install
npm run dev:emulator
```

Phir browser mein:
1. http://localhost:3000/register — account banao (emulator mein fake email OK)
2. Project create karo
3. Classes, datasets, models upload test karo

Emulator UI: http://127.0.0.1:4000

`.env.local` already emulator mode ke liye set hai.

---

## Option 2: Real Firebase (production / Vercel)

### Step 1 — Firebase Console

1. https://console.firebase.google.com/ kholo
2. **Add project** → naam: `label-ai` (ya apna choice)
3. Google Analytics optional — skip kar sakte ho

### Step 2 — Enable services

| Service | Kahan |
|---------|--------|
| **Authentication** | Build → Authentication → Get started → Email/Password ON |
| **Firestore** | Build → Firestore → Create database → Production mode |
| **Storage** | Build → Storage → Get started |

### Step 3 — Web app config

1. Project Settings (gear) → **Your apps** → Web `</>`
2. App nickname: `Label AI`
3. Config copy karo:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
```

4. `.env.local` mein paste karo
5. `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false` set karo (ya line hata do)

### Step 4 — Service account (server)

1. Project Settings → **Service accounts**
2. **Generate new private key** → JSON download
3. Poori JSON ek line mein `.env.local`:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

**Kabhi git mein commit mat karo.**

### Step 5 — Security rules deploy

```bash
npx firebase login
npx firebase use YOUR_PROJECT_ID
npx firebase deploy --only firestore:rules,storage
```

### Step 6 — Vercel env vars

Vercel dashboard → Project → Settings → Environment Variables  
Sab `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_SERVICE_ACCOUNT_JSON` add karo.

### Step 7 — Admin user

Pehla register ke baad Firestore Console mein:

`users/{your-uid}` → field `role` = `admin`

---

## Python worker (auto-label)

```bash
cd worker
pip install -r requirements.txt
```

`worker/.env`:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
WORKER_API_KEY=dev-worker-key
```

```bash
uvicorn main:app --reload --port 8000
```

---

## Verify

```bash
npm run check:firebase
npm run build
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `/setup-error` | `.env.local` missing ya placeholder values |
| Login fail | Auth emulator chal raha? `npm run emulators` |
| Upload fail | Storage rules deploy karo; emulator mode mein emulators ON |
| Server action fail | `FIREBASE_SERVICE_ACCOUNT_JSON` production mein zaroori |
