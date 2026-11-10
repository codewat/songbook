# WorshipDeck — Church Chords & Lyrics Songbook (Offline-First PWA + Firebase Sync)

An installable **Offline-First Progressive Web App (PWA)** built for church worship teams ("tukar sa church"). Store PDF chord charts and lyric images directly inside the app on your device so they work with **zero internet**, and automatically sync new uploads across all team members using your **Firebase account**.

## Features
- **2 Default Folders**: `1. Chords` and `2. Lyrics` (upload PDFs & images to both).
- **Custom Folders & Playlists / Lineups**: Create custom folders (e.g., *Youth Night*, *Christmas*) and Sunday worship lineups with song reordering.
- **100% Offline File Storage**: Files are stored locally in IndexedDB + Service Worker cache (`pdfjs-dist` renders multi-page PDFs offline inside the app on Android, iPhone/iPad, and laptops).
- **Stage / Gig Mode**: Full-screen viewer with zoom, **Stage Dark Mode Invert** (for dim stages), **Keep Screen Awake**, and Prev/Next song navigation (supports keyboard arrows & Bluetooth page-turner pedals).
- **Automatic Team Cloud Sync (Firebase)**: Upload offline or online; changes queue safely in IndexedDB and sync via **Cloud Firestore** (works on the 100% Free Spark Plan with zero CORS setup!) or optionally **Firebase Storage**, with real-time updates via `onSnapshot`.

---

## Local Development

```bash
npm install
npm run dev
```

## Setup Free Firebase Cloud Sync (3 minutes)
1. Open [Firebase Console](https://console.firebase.google.com) and select or create a Firebase project.
2. Enable **Firestore Database** (Free Spark Plan — no credit card needed).
3. Under **Firestore Database → Rules**, paste [`firebase/firestore.rules`](./firebase/firestore.rules) and click **Publish**.
4. Under **Project Settings → Your apps → Add Web App (`</>`)**, copy your `firebaseConfig` snippet.
5. Open **Settings (gear icon)** inside the app, paste the snippet into **Quick Paste Firebase Config Snippet**, and click **Save & Sync Now**.
6. Click **Copy Team Setup Link** and send it to your church group chat so bandmates connect in 1 tap!

*(Optional: You can also pre-fill `.env` using `.env.example` and deploy directly to **Firebase Hosting** with `npm run build && firebase deploy` using the included [`firebase.json`](./firebase.json)!)*

## Installing as an App on Phones & Tablets
Once hosted on Firebase Hosting (`firebase deploy`), Vercel, or Netlify:
- **Android (Chrome)**: Open the link → tap **Install App** / **Add to Home screen**.
- **iPhone / iPad (Safari)**: Open the link → tap **Share** → **Add to Home Screen**.
