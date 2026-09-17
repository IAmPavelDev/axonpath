import { TextClassContext } from '@atomics/text';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Platform, Pressable } from 'react-native';

/*
 * Variant semantics:
 * - default (filled, inverted): the one primary action on screen.
 * - outline: secondary, still clearly pressable.
 * - ghost: low-emphasis controls in headers/toolbars.
 * - destructive: reserved for destructive intent.
 */
const buttonVariants = cva(
  cn(
    'group flex shrink-0 flex-row items-center justify-center gap-2 rounded-lg',
    Platform.select({
      web: 'whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none',
    })
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary active:opacity-80',
        outline: 'border-hairline border-foreground/30 bg-transparent active:bg-accent',
        ghost: 'bg-transparent active:bg-accent',
        secondary: 'bg-secondary active:bg-accent',
        destructive: 'bg-destructive active:opacity-80',
        link: 'bg-transparent active:opacity-60',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-12 px-6',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const buttonTextVariants = cva('font-sans-medium text-[15px]', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-destructive-foreground',
      link: 'text-foreground underline underline-offset-4',
    },
    size: {
      default: '',
      sm: 'text-sm',
      lg: 'text-base',
      icon: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

type ButtonProps = React.ComponentProps<typeof Pressable> &
  React.RefAttributes<typeof Pressable> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(buttonVariants({ variant, size }), props.disabled && 'opacity-50', className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
