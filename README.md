# Ghost Caffee — Espresso Edition v7.2

Ghost Caffee is an Arabic-first chat app with private chats, groups, stories, profiles, reactions, attachments, and moderation tools. The official visual identity is fixed to espresso brown, mocha, caramel, and cream, with a friendly ghost-and-coffee mascot.

## Firebase requirements
- Uses Firebase Authentication **Email/Password provider** with an internal alias derived from the chosen username, plus Firebase Realtime Database only. The UI asks only for a username and password.
- Does not expose an email field or Google sign-in, and does not use Firebase Storage or Cloud Functions.
- In Firebase Console, enable Authentication → Sign-in method → **Email/Password**.
- Keep the existing Firebase project/config and RTDB data paths. `database.rules.json` is intentionally unchanged for this release because the app continues to send an authenticated `auth.uid` and creates the same RTDB record shapes.
- Do not publish a permissive RTDB rules file. The client-side device identifier is not a security boundary.

## Entry and account limitations
The first visit asks for a unique username and password (plus password confirmation). The app derives an internal Firebase identity such as `username@accounts.chatapp.local`; users do not enter a real email address or use Google. After successful creation, the same username/password can be used on another device. There is no email-based password-reset flow, so a forgotten password may make the account unrecoverable.

## Run / deploy
1. Host this folder over HTTPS, e.g. Cloudflare Pages or Firebase Hosting. Do not open `index.html` directly as `file://` for browser preview.
2. Ensure the `firebaseConfig` in `app.js` points to the intended project.
3. Enable the Email/Password provider in Firebase Authentication.
4. Publish only the existing reviewed RTDB rules if the server rules are not already the same. No Storage bucket or Cloud Functions are required.
5. Test with two independent browser profiles/devices: username/password entry, private request approval, direct messages, groups, file-size limits, stories, profile edits, and notifications.

## Offline behavior
The service worker caches the app shell and local assets after an online load. The interface may open offline, but Firebase auth, realtime chat, message sends, and remote profile discovery require network access. This is not a complete offline messaging queue.

## Attachments
Small files are stored as data URLs in Realtime Database to honor the no-Storage requirement. The limit remains 2 MB per attachment; this design is not appropriate for large files or high-volume media.

## Testing
Run `bash tests/run_all.sh`. The included rules simulator is a useful regression check, not a substitute for testing against the live Firebase project and an actual Android device.
