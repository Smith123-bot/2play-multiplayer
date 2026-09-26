import { Link } from 'react-router-dom';
import { findStaticInfoPage } from '@2play/shared';
import { InfoPageShell, InfoSection } from '../components/info/InfoPageShell';
import { AnalyticsConsentControl } from '../analytics/AnalyticsConsentControl';

const PAGE = findStaticInfoPage('/privacy')!;

/**
 * /privacy — the privacy policy. Every statement describes behavior the
 * platform actually implements (verified against the server and client code):
 * nothing is claimed to be collected that is not collected. Optional analytics
 * is described separately and is loaded only after an explicit opt-in choice.
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
          DuoPlay uses no cookies for authentication or preferences. The core platform
          does not load analytics, advertising or third-party trackers unless you explicitly
          allow optional analytics below. Your choice is stored in local storage.
        </p>
        <p>
          If you opt in, the official Google Analytics 4 tag may set first-party analytics
          cookies and receive pseudonymous technical and usage information, such as safe page
          paths, browser/device information and the DuoPlay events listed below. Google may
          use technical signals to provide aggregated reports. Analytics storage, advertising
          storage, Google signals and ad personalization are disabled; DuoPlay does not send
          usernames, room codes, session tokens, chat messages, game moves or other private
          data to Google Analytics.
        </p>
        <AnalyticsConsentControl />
      </InfoSection>

      <InfoSection title="Analytics events">
        <p>
          With consent, DuoPlay records only successful lifecycle actions: when a room is
          created or joined, a game starts or completes, and a favorite is added or removed.
          Events may include a game identifier and a non-sensitive completion reason. Room
          URLs are shortened before they are sent, so room codes are never included.
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
          <strong>Supabase</strong> hosts the database when a deployment enables persistence.
          If you opt in to analytics, Google Analytics 4 processes the limited pseudonymous
          measurement data described above. No ad networks, social widgets or CDNs of user
          content are involved.
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
            You can clear everything the browser stores, including optional analytics cookies,
            by clearing site data in your browser.
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
