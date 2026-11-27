import { useAuth } from '@/lib/auth';
import { ButtonLink, EmptyState } from '@/components/ui';
import { Compass } from 'lucide-react';
export default function NotFound() {
  const { user } = useAuth();
  return <EmptyState icon={<Compass className="size-6" />} title="Page not found" body="The page you were looking for doesn't exist or you don't have access to it." action={<ButtonLink to={user ? '/app' : '/'}>{user ? 'Go to my dashboard' : 'Back to the home page'}</ButtonLink>} />;
}
