import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn('bg-white border border-gray-100 rounded-2xl', className)}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: CardProps) {
  return (
    <div {...props} className={cn('px-6 pt-6 pb-4', className)}>
      {children}
    </div>
  );
}

export function CardContent({ className, children, ...props }: CardProps) {
  return (
    <div {...props} className={cn('px-6 pb-6', className)}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: CardProps) {
  return (
    <div {...props} className={cn('px-6 py-4 border-t border-gray-100', className)}>
      {children}
    </div>
  );
}
