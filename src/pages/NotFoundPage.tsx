import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-vault px-4 text-center">
      <BrandMark />
      <div>
        <div className="font-mono text-[56px] font-extrabold text-ink">404</div>
        <p className="mt-1 text-[14px] text-ink-muted">This vault is empty.</p>
      </div>
      <Link to="/">
        <Button variant="secondary">Back to home</Button>
      </Link>
    </div>
  );
}
