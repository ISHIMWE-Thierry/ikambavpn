/**
 * OTP (One-Time Password) Service
 *
 * Generates 6-digit verification codes for new user email verification.
 * Stores OTPs in Firestore `email_otps` collection and sends them
 * via the `mail` collection (processed by sendMailOnCreate Cloud Function).
 */
import { db } from './firebase';
import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';

// ── Constants ─────────────────────────────────────────────────────────────
const OTP_COLLECTION = 'email_otps';
const MAIL_COLLECTION = 'mail';
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_RESEND_PER_HOUR = 5;
const SENDER_EMAIL = 'team@ikambaventures.com';

// ── Types ─────────────────────────────────────────────────────────────────
interface OtpDoc {
  userId: string;
  email: string;
  code: string;
  expiresAt: string;
  verified: boolean;
  createdAt: string;
  attempts: number;
}

interface VerifyResult {
  success: boolean;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function generateCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % 1_000_000).toString().padStart(OTP_LENGTH, '0');
}

function buildOtpEmailHtml(code: string, userName?: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#000000;padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Ikamba VPN</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">Email Verification</p>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="margin:0 0 16px;color:#374151;font-size:16px;">Hi${userName ? ` ${userName}` : ''},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;">Your verification code is:</p>
          <div style="text-align:center;margin:0 0 24px;">
            <span style="display:inline-block;background:#f9fafb;border:2px solid #e5e7eb;border-radius:12px;padding:16px 40px;font-size:36px;font-weight:800;letter-spacing:10px;color:#111827;font-family:monospace;">
              ${code}
            </span>
          </div>
          <p style="margin:0 0 8px;color:#6b7280;font-size:14px;text-align:center;">
            Expires in <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.
          </p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;text-align:center;">
            If you didn't create an account, ignore this email.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            &copy; ${new Date().getFullYear()} Ikamba VPN &middot; team@ikambaventures.com
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function buildOtpEmailText(code: string, userName?: string): string {
  return [
    `Hi${userName ? ` ${userName}` : ''},`,
    '',
    `Your Ikamba VPN verification code is: ${code}`,
    '',
    `This code expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    '',
    'If you did not create an account, ignore this email.',
    '',
    `© ${new Date().getFullYear()} Ikamba VPN`,
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────

export async function generateAndSendOtp(
  userId: string,
  email: string,
  userName?: string,
): Promise<{ otpDocId: string }> {
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60_000);

  const otpData: OtpDoc = {
    userId,
    email: email.toLowerCase(),
    code,
    expiresAt: expiresAt.toISOString(),
    verified: false,
    createdAt: now.toISOString(),
    attempts: 0,
  };

  const otpRef = await addDoc(collection(db, OTP_COLLECTION), otpData);

  try {
    await addDoc(collection(db, MAIL_COLLECTION), {
      to: [email],
      from: SENDER_EMAIL,
      message: {
        subject: `${code} — Your Ikamba VPN Verification Code`,
        text: buildOtpEmailText(code, userName),
        html: buildOtpEmailHtml(code, userName),
      },
      createdAt: now.toISOString(),
      source: 'otp-verification',
    });
  } catch (err) {
    console.error('[otp] Failed to queue verification email:', err);
  }

  return { otpDocId: otpRef.id };
}

export async function verifyOtp(userId: string, code: string): Promise<VerifyResult> {
  const trimmedCode = code.trim();

  if (trimmedCode.length !== OTP_LENGTH) {
    return { success: false, error: 'Please enter a valid 6-digit code.' };
  }

  const q = query(
    collection(db, OTP_COLLECTION),
    where('userId', '==', userId),
    where('verified', '==', false),
    orderBy('createdAt', 'desc'),
    limit(1),
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    return { success: false, error: 'No pending code found. Please request a new one.' };
  }

  const otpDoc = snap.docs[0];
  const data = otpDoc.data() as OtpDoc;

  if (new Date() > new Date(data.expiresAt)) {
    return { success: false, error: 'This code has expired. Please request a new one.' };
  }

  if (data.attempts >= 5) {
    return { success: false, error: 'Too many attempts. Please request a new code.' };
  }

  await updateDoc(otpDoc.ref, { attempts: data.attempts + 1 });

  if (data.code !== trimmedCode) {
    return { success: false, error: 'Incorrect code. Please try again.' };
  }

  await updateDoc(otpDoc.ref, { verified: true });

  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, {
    emailVerified: 1,
    needsOtpVerification: false,
    emailVerifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return { success: true };
}

export async function canResendOtp(userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const q = query(
    collection(db, OTP_COLLECTION),
    where('userId', '==', userId),
    where('createdAt', '>=', oneHourAgo),
  );
  const snap = await getDocs(q);
  return snap.size < MAX_RESEND_PER_HOUR;
}
