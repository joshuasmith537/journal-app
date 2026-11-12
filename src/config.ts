/**
 * Public client-side Google identifiers. There is no client secret.
 * The Picker API key allows only the Picker API, and only the referrers
 * https://joshuasmith537.github.io/* and http://localhost:5173/*.
 * The page referrer policy is strict-origin-when-cross-origin, so a Picker
 * request from https://joshuasmith537.github.io/journal-app/ sends
 * Referer: https://joshuasmith537.github.io/ and matches that restriction.
 * The only OAuth scope is drive.file. The consent screen is in Testing.
 *
 * Folder and Doc ids point at the existing Personal Journal. They are not
 * access tokens. This app never references the Journal Index, book PDFs,
 * or Media folders.
 */
export const config = {
  googleClientId: "677493523826-8f57ce9pfmibj2p8l08jg1f0mbt01bpq.apps.googleusercontent.com",
  googlePickerApiKey: "AIzaSyDQv6CHB1Iyxa2yCXFNQDQPWGj-RUih8T8",
  googleCloudProjectNumber: "677493523826",
  /**
   * Referrer-restricted key for the Maps JavaScript API bootstrap
   * (`importLibrary("geocoding")`). Empty until it is filled in.
   * This is not a Geocoding REST key.
   */
  GOOGLE_MAPS_API_KEY: "",
  journal: {
    personalFolderId: "1RMiZua4BHSfneXLHH3sCX963XhgCsJCh",
    years: {
      "2026": {
        folderId: "15-u6sgrfrkSfuWjLieFiQHftFKsNyckz",
        months: {
          "10": {
            folderId: "1IMxQ3sCpBGVawMckD8EOTQntfWJLpIMA",
            docId: "1gaTHEFZGNRfawrrM96aQyXX6dnnwW_JwHFNCPfFnJyk",
          },
          "11": {
            folderId: "1Ib_jgzA92NmQfc95troeuVHelkR3kX9j",
            docId: "1krkjtb_clSSS_WMzbFpKYKIK8RxfMsZ5ujuDewH8iTw",
          },
        },
      },
    },
  },
} as const;

export function isConfigured(): boolean {
  return [config.googleClientId, config.googlePickerApiKey, config.googleCloudProjectNumber].every(
    (value) => !value.startsWith("YOUR_"),
  );
}
