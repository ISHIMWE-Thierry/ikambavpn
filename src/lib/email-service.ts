/**
 * Email notification service for Ikamba VPN.
 *
 * Writes to the shared Firestore `mail` collection — the same one that
 * Blink-1's `sendMailOnCreate` Cloud Function watches. Because both apps
 * share the Firebase project (ikamba-1c669), we get the full 3-tier
 * email failover (Brevo API → MailerSend SMTP → Brevo SMTP relay) for free,
 * with no extra Cloud Functions required.
 *
 * Admin/agent recipient resolution order (mirrors Blink-1):
 *   1. appdata/roleCache   – fast cached list maintained by Blink-1
 *   2. notification_recipients collection (enabled == true)
 *   3. vpn_users where role == 'admin'
 */

import { collection, addDoc, getDocs, query, where, getDoc, doc, limit } from 'firebase/firestore';
import { db } from './firebase';

const FROM_NAME = 'Ikamba VPN';

// ── Recipient helpers ─────────────────────────────────────────────────────────

async function getAdminEmails(): Promise<string[]> {
  const emails = new Set<string>();

  try {
    // 1. appdata/roleCache — populated and maintained by Blink-1 Cloud Functions
    const cacheSnap = await getDoc(doc(db, 'appdata', 'roleCache'));
    if (cacheSnap.exists()) {
      const data = cacheSnap.data();
      const admins: Array<{ email?: string; notificationsDisabled?: boolean }> =
        data.admins || [];
      const agents: Array<{ email?: string; notificationsDisabled?: boolean }> =
        data.agents || [];
      for (const entry of [...admins, ...agents]) {
        if (entry.email && !entry.notificationsDisabled) {
          emails.add(entry.email.toLowerCase().trim());
        }
      }
    }
  } catch {
    // cache may not exist yet
  }

  try {
    // 2. notification_recipients collection
    const q = query(
      collection(db, 'notification_recipients'),
      where('enabled', '==', true)
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const email = d.data().email as string | undefined;
      if (email) emails.add(email.toLowerCase().trim());
    });
  } catch {
    // collection may not exist
  }

  try {
    // 3. vpn_users with role admin (our own users collection)
    const q = query(
      collection(db, 'vpn_users'),
      where('role', '==', 'admin'),
      limit(20)
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const email = d.data().email as string | undefined;
      if (email) emails.add(email.toLowerCase().trim());
    });
  } catch {
    // silent
  }

  return Array.from(emails).filter((e) => e.includes('@'));
}

// ── Core mail writer ──────────────────────────────────────────────────────────

async function sendMail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  tag?: string;
}): Promise<void> {
  if (!opts.to.length) return;
  for (const address of opts.to) {
    await addDoc(collection(db, 'mail'), {
      to: [address],
      message: {
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      },
      createdAt: new Date().toISOString(),
      source: 'ikamba-vpn',
      tag: opts.tag || 'vpn',
    });
  }
}

// ── Shared HTML helpers ───────────────────────────────────────────────────────

function baseTemplate(title: string, body: string): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:#000000;padding:20px 24px;text-align:center;">
    <h2 style="color:#ffffff;margin:0;font-size:18px;font-weight:700;">${FROM_NAME}</h2>
    <p style="color:#999999;margin:4px 0 0;font-size:13px;">${title}</p>
  </div>
  <div style="padding:28px 24px;">
    ${body}
  </div>
  <div style="background:#f8f8f8;padding:16px 24px;text-align:center;">
    <p style="color:#999999;font-size:12px;margin:0;">&copy; ${new Date().getFullYear()} Ikamba VPN &mdash; All rights reserved.</p>
  </div>
</div>`.trim();
}

function tableRow(label: string, value: string): string {
  return `
  <tr>
    <td style="padding:8px 0;color:#666666;font-size:13px;width:40%;">${label}</td>
    <td style="padding:8px 0;font-size:13px;font-weight:600;color:#000000;">${value}</td>
  </tr>`;
}

function ctaButton(label: string, url: string): string {
  return `
  <div style="margin-top:24px;text-align:center;">
    <a href="${url}" style="background:#000000;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">${label}</a>
  </div>`;
}

// ── Admin notifications ───────────────────────────────────────────────────────

export interface NewOrderEmailData {
  orderId: string;
  userName: string | null;
  userEmail: string | null;
  planName: string;
  planDuration: string;
  amount: number;
  currency: string;
}

export async function notifyAdminsNewOrder(data: NewOrderEmailData): Promise<void> {
  const admins = await getAdminEmails();
  if (!admins.length) return;

  const subject = `🆕 New VPN Order — ${data.planName} (${data.planDuration})`;
  const body = `
    <h3 style="color:#000000;margin-top:0;">New order received</h3>
    <table style="width:100%;border-collapse:collapse;">
      ${tableRow('Customer', data.userName || 'Unknown')}
      ${tableRow('Email', data.userEmail || 'N/A')}
      ${tableRow('Plan', `${data.planName} — ${data.planDuration}`)}
      ${tableRow('Amount', `${data.currency} ${data.amount.toFixed(2)}`)}
      ${tableRow('Order ID', data.orderId)}
      ${tableRow('Status', 'Pending payment')}
    </table>
    <p style="color:#666666;font-size:13px;margin-top:20px;">
      The customer has been shown payment instructions and will upload proof when done.
    </p>
  `;

  await sendMail({
    to: admins,
    subject,
    html: baseTemplate('New Order Alert', body),
    text: `New VPN order from ${data.userEmail || 'Unknown'}.\nPlan: ${data.planName} (${data.planDuration})\nAmount: ${data.currency} ${data.amount}\nOrder ID: ${data.orderId}`,
    tag: 'vpn-new-order',
  });
}

export interface PaymentProofEmailData {
  orderId: string;
  userName: string | null;
  userEmail: string | null;
  planName: string;
  planDuration: string;
  amount: number;
  currency: string;
  proofUrl: string;
}

export async function notifyAdminsPaymentProof(data: PaymentProofEmailData): Promise<void> {
  const admins = await getAdminEmails();
  if (!admins.length) return;

  const subject = `📎 Payment Proof — ${data.currency} ${data.amount} VPN Order`;
  const body = `
    <h3 style="color:#000000;margin-top:0;">Payment proof submitted</h3>
    <p style="color:#666666;font-size:13px;">
      A customer has uploaded payment proof and is awaiting service activation.
    </p>
    <table style="width:100%;border-collapse:collapse;">
      ${tableRow('Customer', data.userName || 'Unknown')}
      ${tableRow('Email', data.userEmail || 'N/A')}
      ${tableRow('Plan', `${data.planName} — ${data.planDuration}`)}
      ${tableRow('Amount', `${data.currency} ${data.amount.toFixed(2)}`)}
      ${tableRow('Order ID', data.orderId)}
    </table>
    <div style="margin-top:20px;">
      <a href="${data.proofUrl}" style="color:#000000;font-size:13px;font-weight:600;">View payment screenshot →</a>
    </div>
    <p style="color:#ff8c00;font-size:13px;margin-top:16px;font-weight:600;">
      ⚡ Action required: review the proof and activate the service in the admin panel.
    </p>
  `;

  await sendMail({
    to: admins,
    subject,
    html: baseTemplate('Payment Proof — Action Required', body),
    text: `Payment proof uploaded by ${data.userEmail || 'Unknown'}.\nPlan: ${data.planName} (${data.planDuration})\nAmount: ${data.currency} ${data.amount}\nOrder ID: ${data.orderId}\nProof: ${data.proofUrl}`,
    tag: 'vpn-payment-proof',
  });
}

// ── User notifications ────────────────────────────────────────────────────────

export interface ServiceActivatedEmailData {
  userEmail: string;
  userName: string | null;
  planName: string;
  planDuration: string;
  expiresAt?: string;
  serverAddress?: string;
  username?: string;
  password?: string;
  notes?: string;
}

export async function notifyUserServiceActivated(data: ServiceActivatedEmailData): Promise<void> {
  if (!data.userEmail) return;

  const subject = `✅ Your Ikamba VPN service is now active`;
  const hasCredentials = data.serverAddress || data.username;

  const credentialsBlock = hasCredentials
    ? `
    <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin-top:20px;font-family:monospace;">
      <p style="font-size:12px;color:#666666;margin:0 0 10px;font-family:Arial,sans-serif;font-weight:600;">YOUR VPN CREDENTIALS</p>
      ${data.serverAddress ? `<p style="margin:4px 0;font-size:13px;"><span style="color:#999;">Server:</span> ${data.serverAddress}</p>` : ''}
      ${data.username ? `<p style="margin:4px 0;font-size:13px;"><span style="color:#999;">Username:</span> ${data.username}</p>` : ''}
      ${data.password ? `<p style="margin:4px 0;font-size:13px;"><span style="color:#999;">Password:</span> ${data.password}</p>` : ''}
      ${data.notes ? `<p style="margin:10px 0 0;font-size:12px;color:#666666;font-family:Arial,sans-serif;">${data.notes}</p>` : ''}
    </div>`
    : `<p style="color:#666666;font-size:13px;margin-top:16px;">Log in to your dashboard to view your VPN credentials.</p>`;

  const body = `
    <h3 style="color:#000000;margin-top:0;">Your VPN service is active!</h3>
    <p style="color:#666666;font-size:13px;">
      Hi ${data.userName || 'there'}, your Ikamba VPN service has been activated. You can connect now.
    </p>
    <table style="width:100%;border-collapse:collapse;">
      ${tableRow('Plan', `${data.planName} — ${data.planDuration}`)}
      ${data.expiresAt ? tableRow('Expires', new Date(data.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })) : ''}
    </table>
    ${credentialsBlock}
    ${ctaButton('Go to Dashboard', 'https://ikambavpn.com/dashboard')}
  `;

  await sendMail({
    to: [data.userEmail],
    subject,
    html: baseTemplate('Service Activated', body),
    text: `Your Ikamba VPN service is now active!\nPlan: ${data.planName} (${data.planDuration})\n${data.serverAddress ? `Server: ${data.serverAddress}\n` : ''}${data.username ? `Username: ${data.username}\n` : ''}${data.password ? `Password: ${data.password}\n` : ''}Log in to your dashboard for details.`,
    tag: 'vpn-activated',
  });
}

// ── Subscription change notification ──────────────────────────────────────────

export interface SubscriptionChangedEmailData {
  /** The VPN email (may contain .x@ — will be cleaned automatically) */
  vpnEmail: string;
  changeType: 'extended' | 'enabled' | 'disabled' | 'traffic_reset' | 'updated';
  newExpiryMs?: number;       // epoch ms, 0 = never
  newTrafficBytes?: number;   // bytes, 0 = unlimited
  newConnections?: number;
  note?: string;
}

/**
 * Strip the `.x` suffix that 3X-UI adds before the `@` to get the real email.
 * e.g. "user.x@gmail.com" → "user@gmail.com"
 */
function cleanVpnEmail(email: string): string {
  return email.replace(/\.x@/, '@');
}

function formatTraffic(bytes: number): string {
  if (bytes === 0) return 'Unlimited';
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(0)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatExpiry(ms: number): string {
  if (ms === 0) return 'Never (unlimited)';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const changeLabels: Record<SubscriptionChangedEmailData['changeType'], { emoji: string; title: string; desc: string }> = {
  extended:      { emoji: '🚀', title: 'Subscription Extended',   desc: 'Your Ikamba VPN subscription has been extended.' },
  enabled:       { emoji: '✅', title: 'Account Enabled',         desc: 'Your Ikamba VPN account has been re-enabled. You can connect now.' },
  disabled:      { emoji: '⏸️', title: 'Account Paused',          desc: 'Your Ikamba VPN account has been temporarily disabled by an administrator.' },
  traffic_reset: { emoji: '🔄', title: 'Traffic Reset',           desc: 'Your traffic usage has been reset to zero — you have a fresh data allowance.' },
  updated:       { emoji: '📝', title: 'Subscription Updated',    desc: 'Your Ikamba VPN subscription details have been updated.' },
};

export async function notifyUserSubscriptionChanged(data: SubscriptionChangedEmailData): Promise<void> {
  const realEmail = cleanVpnEmail(data.vpnEmail);
  if (!realEmail || !realEmail.includes('@')) return;

  const info = changeLabels[data.changeType];
  const subject = `${info.emoji} ${info.title}`;

  const detailRows: string[] = [];
  if (data.newExpiryMs !== undefined) {
    detailRows.push(tableRow('Expires', formatExpiry(data.newExpiryMs)));
  }
  if (data.newTrafficBytes !== undefined) {
    detailRows.push(tableRow('Data Limit', formatTraffic(data.newTrafficBytes)));
  }
  if (data.newConnections !== undefined) {
    detailRows.push(tableRow('Max Connections', String(data.newConnections)));
  }

  const body = `
    <h3 style="color:#000000;margin-top:0;">${info.title}</h3>
    <p style="color:#666666;font-size:13px;">${info.desc}</p>
    ${detailRows.length ? `
    <table style="width:100%;border-collapse:collapse;">
      ${detailRows.join('\n')}
    </table>` : ''}
    ${data.note ? `<p style="color:#666666;font-size:13px;margin-top:16px;"><strong>Note:</strong> ${data.note}</p>` : ''}
    ${ctaButton('Open Dashboard', 'https://ikambavpn.com/dashboard')}
  `;

  const textParts = [info.desc];
  if (data.newExpiryMs !== undefined) textParts.push(`Expires: ${formatExpiry(data.newExpiryMs)}`);
  if (data.newTrafficBytes !== undefined) textParts.push(`Data: ${formatTraffic(data.newTrafficBytes)}`);
  if (data.newConnections !== undefined) textParts.push(`Connections: ${data.newConnections}`);
  if (data.note) textParts.push(`Note: ${data.note}`);

  try {
    await sendMail({
      to: [realEmail],
      subject,
      html: baseTemplate(info.title, body),
      text: textParts.join('\n'),
      tag: `vpn-${data.changeType}`,
    });
  } catch (err) {
    console.error('[email] Failed to send subscription change email:', err);
    // Don't throw — email failure shouldn't block the admin action
  }
}

export interface OrderStatusEmailData {
  userEmail: string;
  userName: string | null;
  planName: string;
  orderId: string;
  newStatus: string;
  note?: string;
}

export async function notifyUserOrderCancelled(data: OrderStatusEmailData): Promise<void> {
  if (!data.userEmail) return;

  const subject = `Your Ikamba VPN order has been cancelled`;
  const body = `
    <h3 style="color:#000000;margin-top:0;">Order cancelled</h3>
    <p style="color:#666666;font-size:13px;">
      Hi ${data.userName || 'there'}, unfortunately your VPN order could not be processed.
    </p>
    <table style="width:100%;border-collapse:collapse;">
      ${tableRow('Plan', data.planName)}
      ${tableRow('Order ID', data.orderId)}
      ${data.note ? tableRow('Reason', data.note) : ''}
    </table>
    <p style="color:#666666;font-size:13px;margin-top:16px;">
      If you believe this is a mistake or need a refund, please contact our support team.
    </p>
    ${ctaButton('Browse Plans Again', 'https://ikambavpn.com/plans')}
  `;

  await sendMail({
    to: [data.userEmail],
    subject,
    html: baseTemplate('Order Cancelled', body),
    text: `Your Ikamba VPN order (${data.planName} — ${data.orderId}) has been cancelled.${data.note ? ` Reason: ${data.note}` : ''} Contact support if you have questions.`,
    tag: 'vpn-cancelled',
  });
}
