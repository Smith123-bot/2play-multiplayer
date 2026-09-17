import { Link } from 'react-router-dom';
import { Mail, MailWarning } from 'lucide-react';
import { findStaticInfoPage } from '@2play/shared';
import { InfoPageShell, InfoSection } from '../components/info/InfoPageShell';
import { APP_CONFIG } from '../core/config';

const PAGE = findStaticInfoPage('/contact')!;

/**
 * /contact — points at the real, configured contact channel only.
 *
 * The platform ships with no invented email address: the address shown here
 * comes exclusively from the deployment's `VITE_CONTACT_EMAIL` build-time
 * configuration. When it is unset the page says so plainly instead of
 * pretending a mailbox exists.
 */
export default function ContactScreen() {
  const email = APP_CONFIG.contactEmail;

  return (
    <InfoPageShell page={PAGE}>
      {email.length > 0 ? (
        <InfoSection title="Email">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-primary-300" aria-hidden />
            <p>
              Reach the DuoPlay team at{' '}
              <a href={`mailto:${email}`} className="font-medium text-primary-300 hover:underline">
                {email}
              </a>
              . Include your nickname (never your session token) and the room code when your
              question is about a specific match.
            </p>
          </div>
        </InfoSection>
      ) : (
        <InfoSection title="Direct contact">
          <div className="flex items-start gap-3">
            <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
            <p>
              No public contact email is configured for this deployment. The platform does not
              invent one: a deployment publishes its address by setting the{' '}
              <code className="rounded bg-white/10 px-1 py-0.5 text-xs text-white">VITE_CONTACT_EMAIL</code>{' '}
              build-time variable, which is empty here. The resources below answer most
              questions without needing a mailbox.
            </p>
          </div>
        </InfoSection>
      )}

      <InfoSection title="Before writing: quick answers">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <Link to="/faq" className="font-medium text-primary-300 hover:underline">FAQ</Link> — how rooms,
            favorites, statistics, disconnects and chat work, plus troubleshooting steps.
          </li>
          <li>
            <Link to="/privacy" className="font-medium text-primary-300 hover:underline">Privacy Policy</Link> — what
            data exists, where it is stored and how deletion works.
          </li>
          <li>
            <Link to="/terms" className="font-medium text-primary-300 hover:underline">Terms of Service</Link> — the
            behavior rules for names, matches and chat.
          </li>
          <li>
            <Link to="/about" className="font-medium text-primary-300 hover:underline">About DuoPlay</Link> — what the
            platform is and how multiplayer rooms work.
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="What never to send">
        <p>
          Never send your session token or anyone else&apos;s — it is the bearer credential of
          your anonymous identity. DuoPlay staff, where contact is configured, will never ask
          for it either.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
