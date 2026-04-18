import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(135deg,var(--brand-gold),var(--brand-accent))] px-5 py-3 text-slate-950 shadow-[0_0_0_1px_rgba(132,231,255,0.2),0_4px_20px_rgba(89,167,255,0.3)] hover:shadow-[0_0_0_1px_rgba(132,231,255,0.35),0_4px_32px_rgba(89,167,255,0.5)] hover:brightness-110",
        secondary:
          "border border-white/12 bg-white/[0.04] px-5 py-3 text-white hover:border-cyan-300/50 hover:bg-cyan-400/8 hover:shadow-[0_0_20px_rgba(89,167,255,0.12)]",
        ghost: "px-3 py-2 text-slate-300 hover:bg-white/6 hover:text-white",
        link: "px-0 py-0 text-cyan-300 underline-offset-4 hover:underline hover:text-cyan-200",
      },
      size: {
        default: "",
        sm: "px-3 py-2 text-xs",
        lg: "px-7 py-3.5 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
