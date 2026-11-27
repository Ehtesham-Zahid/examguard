# ExamGuard email relay (Google Apps Script)

Render's free plan blocks outgoing SMTP, so ExamGuard sends email through this small Google Apps Script
web app instead. It runs on your Google account, sends from your Gmail, and is called over HTTPS.
It takes about 5 minutes and is free.

## 1. Create the script

1. Sign in to the Google account that should send the emails, then open <https://script.google.com>.
2. Click **New project**. Rename it (top left) to **ExamGuard email relay**.
3. Delete the sample code and paste in everything from [`Code.gs`](./Code.gs).

## 2. Set the secret

1. Make a long random secret. Any of these works:
   - a password manager's generator (40+ characters, letters and numbers), or
   - in a terminal: `openssl rand -hex 24`
2. In `Code.gs`, replace `PASTE-THE-SAME-LONG-RANDOM-SECRET-HERE` with it (keep the quotes).
3. Press **Ctrl/Cmd + S** to save.

## 3. Allow it to send email

1. In the toolbar's function menu choose **testSetup**, then click **Run**.
2. Google asks for permission: **Review permissions** → pick your account → **Advanced** →
   **Go to ExamGuard email relay (unsafe)** → **Allow**. (It's "unverified" only because you wrote it.)
3. The log at the bottom shows the account it sends as and how many emails are left today.

## 4. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. (Requests without the secret are refused.)
4. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

## 5. Add two environment variables to ExamGuard

On Render: **Dashboard → examguard → Environment**, add these, then **Save, rebuild, and deploy**:

| Key | Value |
|---|---|
| `EMAIL_RELAY_URL` | the Web app URL from step 4 (ends in `/exec`) |
| `EMAIL_RELAY_SECRET` | the same secret you put in `Code.gs` |

Locally, put the same two lines in `apps/api/.env` and restart the API.
`SMTP_USER` / `SMTP_PASS` aren't needed with the relay (if both are set, the relay is used).

## 6. Check it

Sign in as the admin → **Email log** → **Send a test email** to your own address. It should show
**Sent** and arrive within a few seconds.

## Good to know

* **Daily limit:** a regular Gmail account can send to about **100 recipients a day** through Apps Script
  (Google Workspace accounts: 1,500). The Email log health check shows how many are left. If the limit is
  reached, emails wait and retry automatically.
* **If you edit `Code.gs` later:** **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
  The URL stays the same.
* **Errors in the Email log:**
  * *"returned a web page instead of JSON"*: the deployment isn't set to **Anyone**, or you copied a `/dev` URL.
  * *"Unauthorized"*: `EMAIL_RELAY_SECRET` doesn't match the secret in `Code.gs`.
  * *"Relay secret is not set"*: you didn't replace the placeholder in `Code.gs` (or didn't redeploy).
