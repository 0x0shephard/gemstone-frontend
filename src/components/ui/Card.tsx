import { cn } from '@/lib/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverLift?: boolean;
  as?: 'div' | 'article' | 'section';
}

/** Obsidian surface with a subtle refracted top edge. */
export function Card({ hoverLift, as: Tag = 'div', className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cn('dc-surface rounded-[4px]', hoverLift && 'dc-hover-lift', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
