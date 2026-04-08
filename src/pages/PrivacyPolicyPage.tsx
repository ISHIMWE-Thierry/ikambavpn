import { Link } from 'react-router-dom';
import { PageTransition } from '../components/PageTransition';

export function PrivacyPolicyPage() {
  return (
    <PageTransition>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 8, 2026</p>

        <div className="prose prose-gray prose-sm sm:prose-base max-w-none space-y-8
          [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3
          [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
          [&_p]:leading-relaxed [&_p]:text-gray-600
          [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:text-gray-600
          [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_ol]:text-gray-600"
        >
          <section>
            <h2>1. Introduction</h2>
            <p>
              Ikamba ("Company", "we", "us", "our") operates the Ikamba VPN service and the website
              at ikambavpn.com. This Privacy Policy explains how we collect, use, and protect your
              information when you use our Service.
            </p>
            <p>
              We are committed to protecting your privacy. Our VPN service is built on the principle
              that your online activity is your business, not ours.
            </p>
          </section>

          <section>
            <h2>2. Our No-Logs Policy</h2>
            <p>
              <strong>We do not log your VPN activity.</strong> Specifically, we do NOT collect, store,
              or monitor:
            </p>
            <ul>
              <li>Your browsing history or the content of your internet traffic</li>
              <li>DNS queries made through our VPN servers</li>
              <li>Your originating IP address when connected to our VPN</li>
              <li>Connection timestamps (when you connected or disconnected)</li>
              <li>Session duration or bandwidth usage per session</li>
              <li>The IP addresses of VPN servers you connect to</li>
            </ul>
            <p>
              Because we do not store this data, we cannot share it with anyone — including law
              enforcement, advertisers, or any third party.
            </p>
          </section>

          <section>
            <h2>3. Information We Do Collect</h2>
            <p>
              To provide the Service, we collect a limited amount of personal information:
            </p>

            <h3>3.1 Account Information</h3>
            <ul>
              <li><strong>Email address</strong> — used for account creation, authentication, and
                customer support communications</li>
              <li><strong>Name</strong> — used for account identification</li>
              <li><strong>Password</strong> — stored in hashed form; we cannot see your password</li>
            </ul>

            <h3>3.2 Payment Information</h3>
            <ul>
              <li><strong>Transaction records</strong> — plan purchased, amount paid, payment method
                (bank transfer or card), and date of payment</li>
              <li><strong>Payment proof uploads</strong> — screenshots or receipts you upload for
                bank transfer verification</li>
            </ul>
            <p>
              Card payments are processed by third-party payment processors (e.g., Stripe via
              RevenueCat). We do not store your card number, CVV, or full card details on our servers.
            </p>

            <h3>3.3 Technical Information</h3>
            <ul>
              <li><strong>Device type and OS</strong> — to provide appropriate VPN configuration files</li>
              <li><strong>App version</strong> — to ensure compatibility and deliver updates</li>
            </ul>

            <h3>3.4 Support Communications</h3>
            <p>
              If you contact us for support, we may retain the content of your messages to resolve
              your issue and improve our Service.
            </p>
          </section>

          <section>
            <h2>4. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul>
              <li>Create and manage your account</li>
              <li>Process payments and verify transactions</li>
              <li>Provision VPN access and deliver connection credentials</li>
              <li>Send transactional emails (order confirmations, credential delivery, account alerts)</li>
              <li>Provide customer support</li>
              <li>Detect and prevent fraud or abuse of the Service</li>
              <li>Improve the Service and fix bugs</li>
            </ul>
            <p>
              We do <strong>not</strong> use your information for targeted advertising, profiling,
              or any purpose unrelated to providing the Service.
            </p>
          </section>

          <section>
            <h2>5. Data Sharing &amp; Third Parties</h2>
            <p>We do not sell, rent, or trade your personal information. We may share limited data with:</p>
            <ul>
              <li>
                <strong>Payment processors</strong> (e.g., Stripe/RevenueCat) — to process card payments.
                They handle your payment details under their own privacy policies.
              </li>
              <li>
                <strong>Firebase (Google)</strong> — for authentication and data storage. Subject to
                Google's privacy practices.
              </li>
              <li>
                <strong>Email delivery services</strong> — to send transactional emails (order
                confirmations, credential delivery).
              </li>
            </ul>
            <p>
              We will not disclose your information to law enforcement unless compelled by a valid
              legal order in our jurisdiction. Since we do not log VPN activity, we have no traffic
              data to share.
            </p>
          </section>

          <section>
            <h2>6. Data Security</h2>
            <p>
              We implement appropriate technical and organizational measures to protect your data:
            </p>
            <ul>
              <li>AES-256 encryption for all VPN traffic</li>
              <li>HTTPS/TLS encryption for all website communications</li>
              <li>Passwords are hashed and never stored in plaintext</li>
              <li>Access to user data is restricted to authorized personnel only</li>
              <li>Regular security reviews of our infrastructure</li>
            </ul>
            <p>
              While we strive to protect your data, no method of transmission over the internet is
              100% secure. We cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2>7. Data Retention</h2>
            <p>
              We retain your account information for as long as your account is active. If you
              request account deletion, we will remove your personal data within 30 days, except
              where we are required by law to retain certain records.
            </p>
            <p>
              Payment transaction records may be retained for up to 12 months for accounting and
              legal compliance purposes.
            </p>
          </section>

          <section>
            <h2>8. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul>
              <li><strong>Access</strong> — request a copy of the personal data we hold about you</li>
              <li><strong>Rectification</strong> — correct inaccurate personal data</li>
              <li><strong>Deletion</strong> — request deletion of your account and personal data</li>
              <li><strong>Data portability</strong> — receive your data in a structured, machine-readable format</li>
              <li><strong>Objection</strong> — object to certain data processing</li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{' '}
              <a href="mailto:support@ikamba.com" className="text-black underline hover:text-gray-700">
                support@ikamba.com
              </a>.
              We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2>9. Cookies</h2>
            <p>
              Our website uses minimal cookies necessary for authentication and session management.
              We do not use tracking cookies, analytics cookies, or advertising cookies.
            </p>
          </section>

          <section>
            <h2>10. Children's Privacy</h2>
            <p>
              Our Service is not intended for children under 18 years of age. We do not knowingly
              collect personal information from children. If we learn that we have collected data
              from a child, we will delete it promptly.
            </p>
          </section>

          <section>
            <h2>11. International Data Transfers</h2>
            <p>
              Your data may be processed on servers located in different countries. By using the
              Service, you consent to the transfer of your data to these locations. We ensure
              appropriate safeguards are in place for any international transfers.
            </p>
          </section>

          <section>
            <h2>12. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted on this
              page with an updated "Last updated" date. Continued use of the Service after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2>13. Contact Us</h2>
            <p>
              If you have questions or concerns about this Privacy Policy or our data practices,
              please contact us:
            </p>
            <ul>
              <li>
                Email:{' '}
                <a href="mailto:support@ikamba.com" className="text-black underline hover:text-gray-700">
                  support@ikamba.com
                </a>
              </li>
              <li>
                Website:{' '}
                <a href="https://ikambavpn.com" className="text-black underline hover:text-gray-700">
                  ikambavpn.com
                </a>
              </li>
            </ul>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-100 text-sm text-gray-400">
          See also:{' '}
          <Link to="/terms" className="underline hover:text-black transition">Terms of Service</Link>
          {' · '}
          <Link to="/refund-policy" className="underline hover:text-black transition">Refund Policy</Link>
        </div>
      </main>
    </PageTransition>
  );
}
