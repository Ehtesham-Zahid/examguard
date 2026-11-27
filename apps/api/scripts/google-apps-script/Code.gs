/**
 * Examify email relay — a Google Apps Script web app that sends Examify's emails from your Gmail.
 *
 * Why: some hosts (Render's free plan) block outbound SMTP. This script runs on Google's servers and is
 * called over HTTPS, so email works anywhere. Setup steps: see SETUP.md next to this file.
 *
 * 1. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → copy the /exec URL
 *    into Examify's EMAIL_RELAY_URL.
 * 2. Project Settings (gear) → Script properties → add RELAY_SECRET = a long random secret; put the same
 *    value into Examify's EMAIL_RELAY_SECRET. (Kept out of the code, so no redeploy is needed to change it.)
 */
const SENDER_NAME = 'Examify'; // the name recipients see
function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty('RELAY_SECRET') || '';
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const SECRET = getSecret_();
    if (SECRET.length < 16) return reply({ ok: false, error: 'Relay secret is not set: add the script property RELAY_SECRET (16+ characters) in Apps Script → Project Settings' });
    if (req.secret !== SECRET) return reply({ ok: false, error: 'Unauthorized: EMAIL_RELAY_SECRET does not match the secret in the Apps Script' });

    if (req.action === 'ping') {
      return reply({ ok: true, quota: MailApp.getRemainingDailyQuota(), account: Session.getEffectiveUser().getEmail() });
    }
    if (req.action !== 'send') return reply({ ok: false, error: 'Bad request: unknown action' });
    if (!req.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.to)) return reply({ ok: false, error: 'Bad request: invalid recipient' });
    if (!req.subject || (!req.html && !req.text)) return reply({ ok: false, error: 'Bad request: subject and body are required' });
    if (MailApp.getRemainingDailyQuota() < 1) return reply({ ok: false, error: 'Daily Gmail sending quota reached — emails will retry automatically later' });

    const options = {
      htmlBody: req.html,
      name: req.name || SENDER_NAME,
    };
    if (req.replyTo) options.replyTo = req.replyTo;
    if (req.attachments && req.attachments.length) {
      options.attachments = req.attachments.map(function (a) {
        return Utilities.newBlob(Utilities.base64Decode(a.base64), String(a.contentType || 'application/octet-stream').split(';')[0], a.filename || 'attachment');
      });
    }
    MailApp.sendEmail(req.to, req.subject, req.text || ' ', options);
    return reply({ ok: true, id: Utilities.getUuid(), quota: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    // quota / temporary Google errors: Examify retries these with backoff
    return reply({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Opening the /exec URL in a browser shows this (no secret needed, reveals nothing). */
function doGet() {
  return reply({ ok: true, service: 'Examify email relay', hint: 'POST only' });
}

/** Run this once from the editor (select testSetup → Run) to grant Gmail permission and check your quota. */
function testSetup() {
  Logger.log('Sending as: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Emails left today: ' + MailApp.getRemainingDailyQuota());
  Logger.log('RELAY_SECRET set: ' + (getSecret_().length >= 16 ? 'yes' : 'no — add it in Project Settings → Script properties'));
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
