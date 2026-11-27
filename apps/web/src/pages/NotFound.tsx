import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@/components/ui';
import { Compass } from 'lucide-react';
export default function NotFound() {
  return <EmptyState icon={<Compass className="size-6" />} title="Page not found" body="The page you were looking for doesn't exist or you don't have access to it." action={<Link to="/"><Button>Go home</Button></Link>} />;
}
