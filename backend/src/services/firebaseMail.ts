/**
 * Backend mail helper.
 *
 * Writes to the shared Firestore `mail` collection — the same one the frontend
 * uses. Blink-1's Cloud Function (`sendMailOnCreate`) picks up new docs and
 * delivers via the 3-tier failover (Brevo API → MailerSend SMTP → Brevo SMTP).
 *
 * No external SMTP/Brevo client needed in the backend.
 */

import { getFirestore } from "./firebase";

export interface MailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  tag?: string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  const db = getFirestore();
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];
  const filtered = recipients.filter((e) => e && e.includes("@"));
  if (!filtered.length) return;

  for (const address of filtered) {
    await db.collection("mail").add({
      to: [address],
      message: {
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      },
      createdAt: new Date().toISOString(),
      source: "ikamba-vpn-backend",
      tag: opts.tag || "vpn-renewal",
    });
  }
}

/** Wrap body content in the standard IkambaVPN black/white email shell. */
export function emailShell(title: string, bodyHtml: string): string {
  const year = new Date().getFullYear();
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:#000000;padding:22px 24px;text-align:center;">
    <h2 style="color:#ffffff;margin:0;font-size:18px;font-weight:700;letter-spacing:0.5px;">Ikamba VPN</h2>
    <p style="color:#999999;margin:4px 0 0;font-size:13px;">${escapeHtml(title)}</p>
  </div>
  <div style="padding:32px 28px;color:#111;line-height:1.55;font-size:15px;">
    ${bodyHtml}
  </div>
  <div style="background:#f7f7f7;padding:18px 24px;text-align:center;">
    <p style="color:#999999;font-size:12px;margin:0;">© ${year} Ikamba VPN — All rights reserved.</p>
  </div>
</div>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
