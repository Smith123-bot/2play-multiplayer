import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { buildNotFoundSeo } from '@2play/shared';
import { EmptyState } from '../components/ui/EmptyState';
import { usePageSeo } from '../seo/usePageSeo';

export function NotFoundScreen() {
  // Unknown route: the server already answered 404 for direct hits; keep the
  // client-rendered head noindexed too so the state survives navigation.
  const seo = useMemo(() => buildNotFoundSeo('Page'), []);
  usePageSeo(seo);

  return (
    <EmptyState
      icon={<Compass className="h-10 w-10 text-primary-300" />}
      title="Page not found"
      description="The page you were looking for does not exist — maybe the room was closed."
      action={
        <Link to="/" className="btn-primary">
          <Home className="h-4 w-4" /> Back home
        </Link>
      }
    />
  );
}

export default NotFoundScreen;
