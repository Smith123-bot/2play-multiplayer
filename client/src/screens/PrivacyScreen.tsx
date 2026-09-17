import { Link } from 'react-router-dom';
import { findStaticInfoPage } from '@2play/shared';
import { InfoPageShell, InfoSection } from '../components/info/InfoPageShell';

const PAGE = findStaticInfoPage('/privacy')!;

/**
 * /privacy — the privacy policy. Every statement describes behavior the
 * platform actually implements (verified against the server and client code):
 * nothing is claimed to be collected that is not collected, and the things
 * the platform genuinely never does (ads, analytics, trackers, cookies for
 * tracking) are stated plainly.
 */
export default function PrivacyScreen() {
  return (
    <InfoPageShell page={PAGE}>
      <InfoSection title="What we process">
        <p>
          DuoPlay works without accounts: you pick a <strong>nickname</strong> and an{' '}
          <strong>avatar emoji</strong>, and the server issues an anonymous{' '}
          <strong>session token</strong> that identifies you between pages and visits. The
          platform processes:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>your nickname, avatar and anonymous session identifiers;</li>
          <li>
            <strong>game statistics</strong> — matches played, wins, losses, draws and win rate
            per game, plus recent match history;
          </li>
          <li>your <strong>favorites</strong> list (the games you heart);</li>
          <li>
            <strong>room and match activity</strong> — room membership, ready states, moves and
            results while a match runs; and
          </li>
          <li>
            <strong>in-room chat messages</strong> you send (text is sanitized, and spam is
            rate-limited).
          </li>
        </ul>
        <p>
          We do not ask for or process an email address, password, phone number, real name,
          location, contacts or payment details — none of those features exist on the
          platform.
        </p>
      </InfoSection>

      <InfoSection title="Where your data lives">
        <p>
          <strong>In your browser:</strong> the session token, nickname, avatar, interface
          settings and recently played games are kept in your browser&apos;s local storage.
          They never leave your device except the session token itself, which is sent with
          requests so the server can recognise you.
        </p>
        <p>
          <strong>On the server:</strong> live rooms run in realtime memory — when a room
          closes, its game state and its chat transcript are deleted with it. Statistics and
          favorites are stored in the platform database. Deployments without a configured
          database keep them in server memory only, where they are lost on restart; the
          production deployment uses Supabase-hosted PostgreSQL for persistence.
        </p>
      </InfoSection>

      <InfoSection title="Cookies, tracking and analytics">
        <p>
          DuoPlay uses <strong>no cookies</strong> — not for authentication, preferences or
          anything else, and it runs <strong>no analytics, no advertising and no third-party
          trackers</strong>. The only browser storage used is local storage (listed above), and
          it is never shared out of band.
        </p>
      </InfoSection>

      <InfoSection title="Logs and network traffic">
        <p>
          The server keeps operational logs (connection events, room lifecycle events and
          errors) to keep the service reliable and to detect abuse. Real-time play and chat
          travel over Socket.IO/WebSocket connections; where the deployment terminates TLS
          (as the production site does), this traffic is encrypted in transit.
        </p>
      </InfoSection>

      <InfoSection title="Third-party services">
        <p>
          The only third party that can store platform data is <strong>Supabase</strong>, which
          hosts the database when a deployment enables persistence. No ad networks, analytics
          providers, social widgets or CDNs of user content are involved.
        </p>
      </InfoSection>

      <InfoSection title="Security">
        <p>
          Traffic is rate-limited, every input is validated and capped in size, nicknames and
          chat are sanitized against HTML injection, room codes are unguessable six-character
          tokens (and brute-force attempts are limited), and the server — never the client —
          decides game results. See the <Link to="/terms" className="font-medium text-primary-300 hover:underline">Terms</Link> for
          the behavior rules that back this up.
        </p>
      </InfoSection>

      <InfoSection title="Retention, control and deletion">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Room state and chat transcripts are deleted when the room closes.</li>
          <li>Idle anonymous sessions are pruned automatically.</li>
          <li>You can change your nickname/avatar and remove favorites at any time.</li>
          <li>
            You can clear everything the browser stores by clearing site data in your browser.
          </li>
          <li>
            Because there are no named accounts, per-user deletion of stored statistics is
            handled case-by-case — reach out via the <Link to="/contact" className="font-medium text-primary-300 hover:underline">contact page</Link>.
          </li>
        </ul>
        <p>
          This policy may be updated as the platform evolves; the date of the latest revision
          is the deployment date published with the service.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
