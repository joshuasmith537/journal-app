/**
 * Google Cloud placeholders. Replace the three YOUR_* values after creating
 * the OAuth client, Picker API key, and noting the project number.
 * Setup is documented in the README.
 *
 * Folder and Doc ids point at the existing Personal Journal. They are not
 * access tokens. This app never references the Journal Index, book PDFs,
 * or Media folders.
 */
export const config = {
  googleClientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  googlePickerApiKey: "YOUR_GOOGLE_PICKER_API_KEY",
  googleCloudProjectNumber: "YOUR_CLOUD_PROJECT_NUMBER",
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
