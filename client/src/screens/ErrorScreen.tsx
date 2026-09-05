import { Link, useRouteError } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';

export function ErrorScreen() {
  const error = useRouteError() as { statusText?: string; message?: string } | null;

  return (
    <EmptyState
      icon={<AlertTriangle className="h-10 w-10 text-danger" />}
      title="Something went wrong"
      description={
        error?.message ?? error?.statusText ?? 'An unexpected error occurred while rendering this page.'
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Link to="/" className="btn-secondary">
            Back home
          </Link>
        </div>
      }
    />
  );
}

export default ErrorScreen;
