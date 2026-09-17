import { cn } from '@/lib/utils';
import * as Slot from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Platform, Text as RNText, type Role } from 'react-native';

/*
 * Type system: Inter carries the interface; Newsreader carries content.
 * Weight lives in the font face (font-sans-semibold etc.), never in
 * font-weight utilities.
 */
const textVariants = cva(
  cn(
    'font-sans text-foreground text-base',
    Platform.select({
      web: 'select-text',
    })
  ),
  {
    variants: {
      variant: {
        default: '',
        /** Page-level serif title. */
        title: 'font-serif text-[34px] leading-[40px] tracking-tight',
        /** Section heading inside a page. */
        heading: 'font-serif text-[22px] leading-[28px] tracking-tight',
        /** Small all-caps group label (tracking does the work, not color). */
        label: 'text-muted-foreground text-[11px] font-sans-medium uppercase tracking-[0.08em]',
        /** Muted single-line support text. */
        muted: 'text-muted-foreground text-sm',
        /** Serif reading body. */
        body: 'font-serif text-[17px] leading-[29px]',
        /** Monospaced/tabular meta figures. */
        meta: 'text-muted-foreground text-[13px] tabular-nums',
        code: 'rounded bg-muted px-1.5 py-0.5 font-mono text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type TextVariantProps = VariantProps<typeof textVariants>;

type TextVariant = NonNullable<TextVariantProps['variant']>;

const ROLE: Partial<Record<TextVariant, Role>> = {
  title: 'heading',
  heading: 'heading',
  code: Platform.select({ web: 'code' as Role }),
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = {
  title: '1',
  heading: '2',
};

const TextClassContext = React.createContext<string | undefined>(undefined);

function Text({
  className,
  asChild = false,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof RNText> &
  TextVariantProps &
  React.RefAttributes<RNText> & {
    asChild?: boolean;
  }) {
  const textClass = React.useContext(TextClassContext);
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      className={cn(textVariants({ variant }), textClass, className)}
      role={variant ? ROLE[variant] : undefined}
      aria-level={variant ? ARIA_LEVEL[variant] : undefined}
      {...props}
    />
  );
}

export { Text, TextClassContext };
