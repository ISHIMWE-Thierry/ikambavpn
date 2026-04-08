import { Link } from 'react-router-dom';
import { PageTransition } from '../components/PageTransition';

export function TermsPage() {
  return (
    <PageTransition>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 8, 2026</p>

        <div className="prose prose-gray prose-sm sm:prose-base max-w-none space-y-8
          [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3
          [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
          [&_p]:leading-relaxed [&_p]:text-gray-600
          [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:text-gray-600
          [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_ol]:text-gray-600"
        >
          <section>
            <h2>1. Agreement to Terms</h2>
            <p>
              By accessing or using the Ikamba VPN service ("Service"), website at ikambavpn.com ("Website"),
              or any related applications, you agree to be bound by these Terms of Service ("Terms").
              If you do not agree to these Terms, you may not use the Service.
            </p>
            <p>
              These Terms constitute a legally binding agreement between you ("User", "you", "your") and
              Ikamba ("Company", "we", "us", "our"), the operator of Ikamba VPN.
            </p>
          </section>

          <section>
            <h2>2. Description of Service</h2>
            <p>
              Ikamba VPN provides a virtual private network service that encrypts your internet connection
              and routes your traffic through secure servers. The Service includes:
            </p>
            <ul>
              <li>Encrypted VPN tunnels using VLESS + REALITY and WireGuard protocols</li>
              <li>Access to VPN servers in multiple locations</li>
              <li>Web-based account management at ikambavpn.com</li>
              <li>Configuration files and connection credentials</li>
            </ul>
          </section>

          <section>
            <h2>3. Eligibility</h2>
            <p>
              You must be at least 18 years old (or the age of majority in your jurisdiction) to use the
              Service. By using the Service, you represent and warrant that you meet this requirement.
            </p>
          </section>

          <section>
            <h2>4. Account Registration</h2>
            <p>
              To use the Service, you must create an account by providing a valid email address and
              creating a password. You are responsible for:
            </p>
            <ul>
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activities that occur under your account</li>
              <li>Notifying us immediately of any unauthorized use of your account</li>
            </ul>
            <p>
              We reserve the right to suspend or terminate accounts that violate these Terms.
            </p>
          </section>

          <section>
            <h2>5. Subscription Plans &amp; Payments</h2>
            <h3>5.1 Plans</h3>
            <p>
              We offer multiple subscription plans (Basic, Popular, Premium) with varying features
              and pricing. Plan details, including pricing in Russian Rubles (₽), are listed on our
              Plans page. Prices are subject to change with reasonable notice.
            </p>
            <h3>5.2 Payment Methods</h3>
            <p>
              We accept payment via bank transfer and card payments (processed through our payment
              partners). All payments are processed securely through third-party payment processors.
            </p>
            <h3>5.3 Billing</h3>
            <p>
              Subscriptions are billed for the duration selected (e.g., monthly). Your subscription
              does not auto-renew — you will need to purchase a new plan when your current plan expires.
            </p>
            <h3>5.4 Free Trial</h3>
            <p>
              We may offer a limited free trial of the Service. Trial accounts are subject to usage
              limitations and are intended for evaluation purposes only. One trial per user.
            </p>
          </section>

          <section>
            <h2>6. Acceptable Use</h2>
            <p>You agree NOT to use the Service to:</p>
            <ul>
              <li>Engage in any activity that is illegal under applicable law</li>
              <li>Transmit malware, viruses, or other harmful software</li>
              <li>Send spam, phishing messages, or unsolicited bulk communications</li>
              <li>Infringe on the intellectual property rights of others</li>
              <li>Harass, threaten, or harm other individuals</li>
              <li>Attempt to gain unauthorized access to other systems or networks</li>
              <li>Distribute child exploitation material (zero tolerance)</li>
              <li>Engage in activities that consume excessive bandwidth in a way that degrades
                the Service for other users</li>
              <li>Resell, redistribute, or share your VPN credentials with others</li>
            </ul>
            <p>
              Violation of these rules may result in immediate termination of your account without
              refund.
            </p>
          </section>

          <section>
            <h2>7. Privacy &amp; Logging Policy</h2>
            <p>
              We are committed to your privacy. We operate a strict no-logs policy — we do not monitor,
              record, or store your browsing activity, connection timestamps, DNS queries, IP addresses,
              or traffic data. For full details, please see our{' '}
              <Link to="/privacy" className="text-black underline hover:text-gray-700">
                Privacy Policy
              </Link>.
            </p>
          </section>

          <section>
            <h2>8. Intellectual Property</h2>
            <p>
              All content on the Website, including text, graphics, logos, and software, is the property
              of Ikamba and is protected by intellectual property laws. You may not copy, modify,
              distribute, or reverse-engineer any part of the Service without our written permission.
            </p>
          </section>

          <section>
            <h2>9. Service Availability</h2>
            <p>
              We strive to maintain 99.9% uptime but do not guarantee uninterrupted access to the
              Service. We may temporarily suspend the Service for maintenance, updates, or circumstances
              beyond our control. We are not liable for any downtime or service interruptions.
            </p>
          </section>

          <section>
            <h2>10. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Ikamba shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages arising out of or related to
              your use of the Service, including but not limited to:
            </p>
            <ul>
              <li>Loss of data, revenue, or profits</li>
              <li>Inability to access certain websites or services while using the VPN</li>
              <li>Actions taken by third parties</li>
              <li>Service interruptions or technical failures</li>
            </ul>
            <p>
              Our total liability shall not exceed the amount you paid for the Service in the
              preceding 12 months.
            </p>
          </section>

          <section>
            <h2>11. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind,
              either express or implied, including but not limited to warranties of merchantability,
              fitness for a particular purpose, or non-infringement.
            </p>
          </section>

          <section>
            <h2>12. Termination</h2>
            <p>
              We may terminate or suspend your account at any time if you violate these Terms. You may
              also terminate your account at any time by contacting us at{' '}
              <a href="mailto:support@ikamba.com" className="text-black underline hover:text-gray-700">
                support@ikamba.com
              </a>.
              Upon termination, your right to use the Service ceases immediately.
            </p>
          </section>

          <section>
            <h2>13. Refund Policy</h2>
            <p>
              Please refer to our separate{' '}
              <Link to="/refund-policy" className="text-black underline hover:text-gray-700">
                Refund Policy
              </Link>{' '}
              for details on eligibility and the refund process.
            </p>
          </section>

          <section>
            <h2>14. Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms at any time. Changes will be posted on this
              page with an updated "Last updated" date. Continued use of the Service after changes
              constitutes acceptance of the new Terms. We may notify you of material changes via email.
            </p>
          </section>

          <section>
            <h2>15. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable law. Any
              disputes arising from these Terms or the Service shall be resolved through good-faith
              negotiation, and if necessary, binding arbitration.
            </p>
          </section>

          <section>
            <h2>16. Contact Us</h2>
            <p>
              If you have any questions about these Terms, please contact us:
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
      </main>
    </PageTransition>
  );
}
