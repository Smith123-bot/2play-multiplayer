import { Link } from 'react-router-dom';
import { findStaticInfoPage } from '@2play/shared';
import { InfoPageShell, InfoSection } from '../components/info/InfoPageShell';

const PAGE = findStaticInfoPage('/terms')!;

/**
 * /terms — Terms of Service scoped strictly to what the platform is and does:
 * a browser-played, 2D, real-time multiplayer platform with anonymous
 * sessions and in-room chat. No jurisdiction or enforcement machinery that
 * does not exist is invented here.
 */
export default function TermsScreen() {
  return (
    <InfoPageShell page={PAGE}>
      <InfoSection title="The service">
        <p>
          DuoPlay provides real-time 2D multiplayer games playable in the browser with
          friends, with public rooms, with an in-room text chat, with per-game statistics and
          with a favorites list. By using the platform you accept these terms.
        </p>
      </InfoSection>

      <InfoSection title="Acceptable use and usernames">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Use the platform lawfully and fairly.</li>
          <li>
            Nicknames/avatars must be polite: they are validated and sanitized by the server,
            and HTML or markup is stripped automatically. Names that impersonate, harass or
            mislead are not allowed.
          </li>
          <li>
            You are responsible for your anonymous session token — it is your identity. Keep
            it on your own device; anyone holding it can act as you on this platform.
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="Multiplayer behavior and chat">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Play to win within the rules — the server is authoritative and rejects illegal moves.</li>
          <li>No harassment, threats, hate speech or targeted abuse toward other players.</li>
          <li>
            Chat is for the room, not for advertising or flooding: messages are rate-limited
            and repeated flooding is muted automatically.
          </li>
          <li>Do not share room codes from private rooms with people the host has not invited.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Prohibited abuse">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>No cheating: forged actions, score or result fabrication, or tampering with the client to gain an advantage.</li>
          <li>No brute-forcing of room codes, session tokens or other access inputs.</li>
          <li>No denial-of-service behavior, payload floods or attempts to evade rate limits.</li>
          <li>No disrupting rooms (joining to grief, spam, or repeatedly abandoning matches).</li>
          <li>No scraping of the API or realtime transport beyond normal play.</li>
        </ul>
        <p>
          The platform enforces many of these rules technically (validation, rate limits,
          disconnects of oversized or malformed traffic); deliberate abuse may also lose you
          access to the service where the deployment can identify you for that purpose.
        </p>
      </InfoSection>

      <InfoSection title="Service availability">
        <p>
          DuoPlay is provided on a best-effort basis: games may be added, changed or retired,
          and the service may be unavailable for maintenance or failures. No level of uptime,
          latency or feature continuity is guaranteed.
        </p>
      </InfoSection>

      <InfoSection title="Content and ownership">
        <p>
          The platform, its code, design and the games belong to their respective owners. The
          text you type in chat stays your message, shown to the players in your room as part
          of the service; room transcripts are deleted when the room closes. Statistics and
          match histories attached to your anonymous session exist to provide the service.
        </p>
      </InfoSection>

      <InfoSection title="Disclaimers and liability">
        <p>
          The service is provided <strong>&quot;as is&quot; and &quot;as available&quot;</strong>{' '}
          without warranties of any kind, express or implied. To the maximum extent permitted
          by applicable law, the operators are not liable for indirect or consequential
          damages, data loss in sessions or rooms, or actions of other players. Nothing in
          these terms limits liability that cannot lawfully be limited.
        </p>
        <p>
          These terms may change as the platform evolves; continued use after a change means
          you accept the updated terms. Questions go through the{' '}
          <Link to="/contact" className="font-medium text-primary-300 hover:underline">contact page</Link>; data handling is
          described in the <Link to="/privacy" className="font-medium text-primary-300 hover:underline">Privacy Policy</Link>.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
