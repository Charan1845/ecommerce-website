/**
 * Sending email, through Resend.
 *
 * Switched off unless RESEND_API_KEY is set. With no key the shop behaves
 * exactly as it did before email existed - the same approach payments take,
 * so a fresh clone still runs with nothing configured.
 *
 * -------------------------------------------------------------------------
 * WHAT RESEND WILL ACTUALLY DELIVER
 *
 * Until a domain is verified, Resend only sends to the address that owns the
 * account, from `onboarding@resend.dev`. Everything else is accepted by the
 * API and quietly dropped.
 *
 * That is fine for a demo - the only person who needs a reset link is the
 * person who owns the shop - but it must not be mistaken for working email.
 * A reset requested by anybody else will look successful and never arrive,
 * which is exactly the failure that wastes an afternoon. Verify a domain
 * before believing otherwise.
 * -------------------------------------------------------------------------
 */

const RESEND_API = 'https://api.resend.com/emails';

const apiKey = () => process.env.RESEND_API_KEY || '';

/** Is email configured at all? */
const isEnabled = () => Boolean(apiKey());

/**
 * Resend's shared sender works without owning a domain. Override it with
 * MAIL_FROM once a domain is verified.
 */
const from = () => process.env.MAIL_FROM || 'DevGear <onboarding@resend.dev>';

/**
 * Where the links in an email should point.
 *
 * Taken from configuration rather than from the incoming request. A password
 * reset link built out of the Host header is a well-known way to be tricked
 * into emailing somebody a link that points at an attacker's site.
 */
function siteUrl() {
  const url = process.env.SITE_URL || 'http://localhost:3000';
  return url.replace(/\/+$/, '');
}

/**
 * Send one email. Resolves to { sent: true } or { sent: false, reason }.
 *
 * Never throws. A password reset should not fail because a mail provider is
 * having a bad afternoon, and the caller deliberately tells the visitor the
 * same thing either way.
 */
async function send({ to, subject, text, html }) {
  if (!isEnabled()) {
    return { sent: false, reason: 'email is not configured' };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: from(), to: [to], subject, text, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      // Logged for the operator, never returned to the browser - the reply
      // would otherwise reveal whether an address is registered.
      console.error(`email failed (${res.status}):`, body.slice(0, 300));
      return { sent: false, reason: `provider returned ${res.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('email failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

/** The password reset email. Plain text and HTML, because some clients show one. */
function resetEmail({ username, link, minutes }) {
  const text = [
    `Hello ${username},`,
    '',
    'Someone asked to reset the password on your DevGear account.',
    'Open this link to choose a new one:',
    '',
    link,
    '',
    `The link works once and stops working after ${minutes} minutes.`,
    '',
    'If this was not you, you can ignore this email. Your password has not',
    'changed and nobody can get in without this link.',
    '',
    'DevGear - a demo store. No real orders are fulfilled.',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height:1.6; color:#0f172a">
      <p>Hello ${escapeHtml(username)},</p>
      <p>Someone asked to reset the password on your DevGear account.</p>
      <p>
        <a href="${escapeHtml(link)}"
           style="display:inline-block; background:#2563eb; color:#fff; padding:11px 20px;
                  border-radius:8px; text-decoration:none; font-weight:600">
          Choose a new password
        </a>
      </p>
      <p style="color:#475569; font-size:14px">
        The link works once and stops working after ${minutes} minutes.
      </p>
      <p style="color:#475569; font-size:14px">
        If this was not you, you can ignore this email. Your password has not
        changed and nobody can get in without this link.
      </p>
      <hr style="border:0; border-top:1px solid #e2e8f0; margin:22px 0">
      <p style="color:#94a3b8; font-size:12px">
        DevGear - a demo store. No real orders are fulfilled.
      </p>
    </div>`;

  return { subject: 'Reset your DevGear password', text, html };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

module.exports = { isEnabled, send, resetEmail, siteUrl, from };
