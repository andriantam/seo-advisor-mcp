# Setting up Google access

You need three things, all free:

1. A **service account** and its JSON key, for Search Console and GA4
2. That service account **added as a reader** on your Search Console property and your GA4 property
3. A **PageSpeed Insights API key**, for Lighthouse

Menu names in Google's consoles change now and then, so treat the paths below as a guide.

## 1. Create a Google Cloud project and enable the APIs

1. Go to <https://console.cloud.google.com> and sign in.
2. Open the project picker at the top, choose **New project**, name it (for example `seo-advisor`) and create it.
3. Go to **APIs & Services → Library** and enable all three of:
   - **Google Search Console API**
   - **Google Analytics Data API**
   - **Google Analytics Admin API** (optional; lets Claude list your GA4 properties so you can find the property ID)
   - **PageSpeed Insights API**

## 2. Create a service account and download its key

1. **IAM & Admin → Service Accounts → Create service account.** Give it a name. You can skip the optional role steps; it needs no Google Cloud roles.
2. Copy its email address. It ends in `iam.gserviceaccount.com`. You will need it twice below.
3. Open the account, go to **Keys → Add key → Create new key → JSON**. A file downloads.
4. Move it somewhere private and lock it down.

   **macOS / Linux**

   ```bash
   mkdir -p ~/.config/seo-advisor
   mv ~/Downloads/<downloaded-key>.json ~/.config/seo-advisor/key.json
   chmod 600 ~/.config/seo-advisor/key.json
   ```

   **Windows (PowerShell)**

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\seo-advisor" | Out-Null
   Move-Item "$env:USERPROFILE\Downloads\<downloaded-key>.json" "$env:USERPROFILE\.config\seo-advisor\key.json"
   ```

If Google refuses to create a key, your organisation has a policy blocking service-account keys (`iam.disableServiceAccountKeyCreation`). Use a personal Google account or ask an admin to allow it for this project.

**Never** commit this file, paste it into a chat, or put it in a public folder. If it leaks, delete the key in the Cloud Console (Keys tab) and create another.

## 3. Give the service account access to your data

### Search Console

1. Open <https://search.google.com/search-console> and pick your property. If your site isn't verified yet, add and verify it first (a **Domain** property verified with a DNS TXT record is the most complete).
2. **Settings → Users and permissions → Add user.**
3. Paste the service account email and choose **Restricted** (read-only).

Your property id is `sc-domain:example.com` for a Domain property, or the full URL with a trailing slash (`https://example.com/`) for a URL-prefix property. Use exactly the form shown in Search Console.

### Google Analytics 4

1. Open <https://analytics.google.com> and go to **Admin**.
2. Under the **property** column, choose **Property access management**.
3. Click **+ → Add users**, paste the service account email and choose **Viewer**.
4. Find your property id under **Admin → Property settings → Property details**. It is a number such as `123456789`.

## 4. Create a PageSpeed Insights key (Lighthouse)

1. **APIs & Services → Credentials → Create credentials → API key.**
2. Click the new key, under **API restrictions** choose **Restrict key** and select **PageSpeed Insights API**. Save.

Without a key, PageSpeed Insights works from a shared anonymous quota that is frequently used up, so `psi_report` will often fail with a quota error. A free key gives you your own allowance.

## 5. Check it works

Once the server is registered with Claude (see [install.md](install.md)), ask:

> List my Search Console properties and show my GA4 realtime users.

| You see | It means |
|---|---|
| Your property in the list | It works |
| An empty `gsc_list_sites` list | The service account email wasn't added to the property |
| `403` from GA4 | The Analytics Data API isn't enabled, or the email isn't a Viewer on that property |
| `ga_list_properties` fails | The Analytics Admin API isn't enabled in the same project |
| `PERMISSION_DENIED` on a Search Console call | The `siteUrl` doesn't match the property exactly (check `sc-domain:` versus URL form) |
| "Unable to read the credential file" | `GOOGLE_APPLICATION_CREDENTIALS` points at the wrong path |
| A quota error from `psi_report` | Set `PSI_API_KEY` |

A brand-new GA4 property or a newly verified Search Console property has little or no data yet. Search Console data also lags by about 2-3 days.
