# Setting up Bing Webmaster Tools

Bing's data also covers engines that build on Bing, so it is worth having next to Google's.

1. Sign in at <https://www.bing.com/webmasters> and add your site. The quickest way is **Import from Google Search Console**, which verifies it for you.
2. Open **Settings → API access**, accept the terms if asked, and **Generate API key**. You get one key per account, and it works for every site you have verified. Do not share it.
3. Save the key to a private file. Copy it to your clipboard first, then:

   **macOS**

   ```bash
   mkdir -p ~/.config/seo-advisor
   pbpaste > ~/.config/seo-advisor/bing-api-key.txt
   chmod 600 ~/.config/seo-advisor/bing-api-key.txt
   ```

   **Linux** (with `xclip`)

   ```bash
   mkdir -p ~/.config/seo-advisor
   xclip -selection clipboard -o > ~/.config/seo-advisor/bing-api-key.txt
   chmod 600 ~/.config/seo-advisor/bing-api-key.txt
   ```

   **Windows (PowerShell)**

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\seo-advisor" | Out-Null
   Get-Clipboard | Set-Content -NoNewline "$env:USERPROFILE\.config\seo-advisor\bing-api-key.txt"
   ```

4. Register the server with `BING_WEBMASTER_API_KEY_FILE` pointing at that file, and optionally `BING_SITE_URL` set to your site (see [install.md](install.md)). Using a file keeps the key out of your Claude config.
5. Check it: ask Claude to run `bing_list_sites`. Your site should appear.

If you get a 401 or 403, the key is wrong or the site isn't verified in the same Bing account that created the key.
