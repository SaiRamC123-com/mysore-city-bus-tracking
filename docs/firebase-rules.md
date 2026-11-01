# Firebase security rules

The server uses the Firebase Admin SDK, which bypasses security rules, so the rules only need to protect the data from the browser.

## Realtime Database (live bus positions)

Anyone may read `bus_live` (the client subscribes to it). Nobody may write from a browser.

```json
{
  "rules": {
    "bus_live": { ".read": true, ".write": false },
    ".read": false,
    ".write": false
  }
}
```

## Firestore (routes, stops, logs)

The browser never touches Firestore. Everything goes through the server.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

## Notes

- "Test mode" rules expire after 30 days and are open to everyone. Replace them with the rules above before sharing the app.
- `serviceAccountKey.json` is a secret. Keep it out of git (the root `.gitignore` already does), and never put it in `client/`.
- The Firebase web config in `client/.env` is public by design; it identifies the project and grants nothing on its own.
- `GROQ_API_KEY` and `DRIVER_SECRET` live only in `server/.env`.
