import { Link } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundScreen() {
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
