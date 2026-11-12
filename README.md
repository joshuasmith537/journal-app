# Personal Journal

A small installable journal for one person. It does three things:

- Write an entry (date, place, weather, title, mood, body, tags).
- Read past entries, newest first.
- Append a published entry to the matching Personal Journal Google Doc.

Drafts stay in this browser. Publishing while offline keeps the entry on the device and syncs it the next time the browser is online and signed in. There is no backend and no analytics.

## Privacy

- Entry text lives in IndexedDB on the device, and in the Google Doc after you publish.
- The Google access token stays in memory. It is not written to disk.
- The app asks only for `https://www.googleapis.com/auth/drive.file`. It can open a Drive file after you pick it, and it can create files inside a folder you picked. It cannot see the rest of Drive.
- A folder pick does not include files that were already in that folder. Existing month docs have to be picked themselves. Details are in the pull request that introduced this app.
- Weather uses [Open-Meteo](https://open-meteo.com/). The forecast request sends coordinates only. The default place `Chicago, IL` uses a fixed coordinate pair, so that name is not sent. If you edit the place, that name is sent to Open-Meteo's geocoding API to find coordinates. Journal text is never sent there.
- Open-Meteo does not offer reverse geocoding, so the app does not ask for browser location and never shows coordinates.
- `src/config.ts` contains the Personal Journal folder and Doc ids so the app knows which files to ask you to grant. Those ids are not access tokens. Do not commit entry text, tokens, or secrets.

The app never reads or writes the Journal Index, book PDFs, Media folders, or anything named Accountability Journal.

## Run it locally

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5173/journal-app/ . The dev server and the GitHub Pages site both use the `/journal-app/` base path.

`npm run build` typechecks and writes `dist/`. `npm run preview` serves that build.

## Google Cloud setup

Create one Cloud project, then fill in the three `YOUR_*` values in `src/config.ts`.

1. Enable **Google Drive API**, **Google Docs API**, and **Google Picker API**.
2. OAuth consent screen: External, app name “Personal Journal”. Add `joshuasmith537@gmail.com` as a test user. Leave the app in Testing. The only scope this app requests is non-sensitive `https://www.googleapis.com/auth/drive.file` (“See, edit, create, and delete only the specific Google Drive files you use with this app”). Do not add a Drive-wide scope.
3. Create an OAuth client ID of type **Web application**. Authorized JavaScript origins:
   - `https://joshuasmith537.github.io`
   - `http://localhost:5173`
   The token flow does not use a client secret or a redirect URI. Copy the client ID into `googleClientId`.
4. Create an API key for the Google Picker. Restrict it:
   - Application restriction: HTTP referrers `https://joshuasmith537.github.io/*` and `http://localhost:5173/*`
   - API restriction: Google Picker API
   If the picker reports that the key cannot call Drive, add the Drive API to that key’s API restriction as well. The OAuth token still limits the app to files you pick. Copy the key into `googlePickerApiKey`.
5. Copy the Cloud project **number** (not the project id) into `googleCloudProjectNumber`. The picker needs it so a file you select is actually granted to this app.

After the keys are in place, sign in and choose the Personal folder, each year and month folder you want the app to create files in, and each existing Personal Journal doc. October 2026 and November 2026 are already listed in `src/config.ts`. If one of those docs is not granted, the app asks you to pick it. It will not create a second copy. For a later month, the app opens the file picker in the year folder (or Personal, if that year folder is not shared yet) before it creates anything, and the confirm step lists the exact folder and doc names.

## GitHub Pages

The workflow `.github/workflows/pages.yml` runs tests on every pull request and deploys `dist/` when that workflow runs on `main`.

In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The first deploy creates the `github-pages` environment. The site is https://joshuasmith537.github.io/journal-app/ .

The production build adds a Content-Security-Policy. `script-src` includes `'unsafe-eval'` because Google’s Picker loader (`apis.google.com/js/api.js`) evaluates script text. The app’s own scripts do not.

## Format

New entries are appended to `Personal Journal – <Month YYYY>` with the banner count incremented, using the Doc `revisionId` as `writeControl.requiredRevisionId`. A conflict re-reads the Doc and retries. The app adds `Source: journal-app` on the line after the status. Assumptions that the format spec does not pin down are listed in the pull request.
