import { Link } from 'react-router-dom';
import { PageTransition } from '../components/PageTransition';

export function RefundPolicyPage() {
  return (
    <PageTransition>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Refund Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 8, 2026</p>

        <div className="prose prose-gray prose-sm sm:prose-base max-w-none space-y-8
          [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3
          [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
          [&_p]:leading-relaxed [&_p]:text-gray-600
          [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:text-gray-600
          [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_ol]:text-gray-600"
        >
          <section>
            <h2>1. Overview</h2>
            <p>
              We want you to be satisfied with Ikamba VPN. This Refund Policy explains when and how
              you can request a refund for your subscription purchase.
            </p>
          </section>

          <section>
            <h2>2. Refund Eligibility</h2>
            <p>
              You may request a full refund within <strong>7 days</strong> of your original purchase
              date if:
            </p>
            <ul>
              <li>The Service does not work as described and we are unable to resolve the issue</li>
              <li>You are unable to connect to any of our VPN servers despite following our setup guides</li>
              <li>Your account was charged in error (e.g., duplicate payment)</li>
            </ul>
          </section>

          <section>
            <h2>3. Refund Exclusions</h2>
            <p>
              Refunds will <strong>not</strong> be issued in the following cases:
            </p>
            <ul>
              <li>The request is made more than 7 days after the purchase date</li>
              <li>Your account has been terminated due to violation of our{' '}
                <Link to="/terms" className="text-black underline hover:text-gray-700">
                  Terms of Service
                </Link>
              </li>
              <li>You have used a significant portion of the subscription period (more than 50%)</li>
              <li>The Service was working correctly but you simply changed your mind after extended use</li>
              <li>You purchased the wrong plan — in this case, contact us and we'll help you switch plans</li>
              <li>Issues caused by your internet service provider, local network, or device configuration
                that are outside our control</li>
            </ul>
          </section>

          <section>
            <h2>4. Free Trial</h2>
            <p>
              We offer a free trial so you can evaluate the Service before purchasing. Since you can
              test the Service at no cost, we encourage you to use the trial before committing to a
              paid plan. This does not affect your eligibility for a refund on paid subscriptions.
            </p>
          </section>

          <section>
            <h2>5. How to Request a Refund</h2>
            <p>To request a refund:</p>
            <ol>
              <li>
                Send an email to{' '}
                <a href="mailto:support@ikamba.com" className="text-black underline hover:text-gray-700">
                  support@ikamba.com
                </a>{' '}
                with the subject line "Refund Request"
              </li>
              <li>Include your account email address and order details</li>
              <li>Describe the reason for your refund request</li>
              <li>If the issue is technical, include any error messages or screenshots</li>
            </ol>
          </section>

          <section>
            <h2>6. Refund Processing</h2>
            <p>
              Once we receive your refund request, we will:
            </p>
            <ul>
              <li>Review your request within <strong>3 business days</strong></li>
              <li>Contact you if we need additional information or want to help resolve a technical issue</li>
              <li>If approved, process the refund within <strong>5–10 business days</strong></li>
            </ul>
            <p>
              Refunds will be issued to the original payment method:
            </p>
            <ul>
              <li><strong>Card payments</strong> — refunded to the original card. May take 5–10 business
                days to appear on your statement depending on your bank.</li>
              <li><strong>Bank transfers</strong> — refunded to the bank account used for payment, or
                an alternative account you provide.</li>
            </ul>
          </section>

          <section>
            <h2>7. Partial Refunds</h2>
            <p>
              In some cases, we may offer a partial refund based on the unused portion of your
              subscription. This is calculated on a pro-rata basis from the date of your refund
              request to the end of your subscription period.
            </p>
          </section>

          <section>
            <h2>8. Plan Changes</h2>
            <p>
              If you purchased the wrong plan, contact us instead of requesting a refund. We can
              help you upgrade or downgrade your plan and adjust the billing accordingly.
            </p>
          </section>

          <section>
            <h2>9. Chargebacks</h2>
            <p>
              We encourage you to contact us directly before initiating a chargeback with your bank
              or card issuer. We are committed to resolving disputes promptly and fairly. Unwarranted
              chargebacks may result in account suspension.
            </p>
          </section>

          <section>
            <h2>10. Changes to This Policy</h2>
            <p>
              We may update this Refund Policy from time to time. Changes will be posted on this
              page with an updated "Last updated" date. The policy in effect at the time of your
              purchase applies to that transaction.
            </p>
          </section>

          <section>
            <h2>11. Contact Us</h2>
            <p>
              For refund requests or questions about this policy:
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
          <Link to="/privacy" className="underline hover:text-black transition">Privacy Policy</Link>
        </div>
      </main>
    </PageTransition>
  );
}
