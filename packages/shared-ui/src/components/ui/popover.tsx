/* shadcn/ui-derived */
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";
import {
  type ResponsiveOverlayContextValue,
  useResponsiveRoot,
  MobileTrigger,
  ResponsiveDrawerShell,
  ResponsiveOverlayViewport,
  stripRadixContentProps,
} from "./responsive-overlay.js";
import {
  getOverlayTriggerClassName,
  preventOverlayTriggerSelection,
} from "./overlay-trigger.js";

// ---------------------------------------------------------------------------
// Context — separate instance from DropdownMenu
// ---------------------------------------------------------------------------

const ResponsivePopoverContext =
  React.createContext<ResponsiveOverlayContextValue>({
    isCompactViewport: false,
    open: false,
    onOpenChange: () => {},
  });

function useResponsivePopover() {
  return React.useContext(ResponsivePopoverContext);
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function Popover({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnChange,
  defaultOpen,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const ctx = useResponsiveRoot(
    controlledOpen,
    controlledOnChange,
    defaultOpen,
  );

  const body = (
    <ResponsivePopoverContext.Provider value={ctx}>
      <ResponsiveOverlayViewport isCompactViewport={ctx.isCompactViewport}>
        {children}
      </ResponsiveOverlayViewport>
    </ResponsivePopoverContext.Provider>
  );

  if (ctx.isCompactViewport) {
    return body;
  }

  return (
    <PopoverPrimitive.Root
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      {...props}
    >
      {body}
    </PopoverPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

const PopoverTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ asChild, children, className, ...props }, ref) => {
  const { isCompactViewport, open, onOpenChange } = useResponsivePopover();

  if (isCompactViewport) {
    return (
      <MobileTrigger
        ref={ref}
        asChild={asChild}
        open={open}
        onOpenChange={onOpenChange}
        haspopup="dialog"
        className={className}
        {...props}
      >
        {children}
      </MobileTrigger>
    );
  }

  return (
    <PopoverPrimitive.Trigger
      ref={ref}
      asChild={asChild}
      className={getOverlayTriggerClassName(className)}
      // preventDefault only, and deliberately no pre-blur: this branch is
      // Radix-managed floating content, and Radix moves focus into it once it
      // opens. Blurring here instead would put focus nowhere for the whole
      // press — Radix opens on click, not on mousedown — and a composer that
      // collapses when focus settles off it (the compact prompt box) reads
      // that gap as "the user clicked away", folds up, and takes this very
      // trigger with it before the click can land. Keeping focus in the editor
      // until the overlay is actually open is what lets the composer's
      // aria-expanded guard see an open overlay and stay put.
      onMouseDown={preventOverlayTriggerSelection}
      {...props}
    >
      {children}
    </PopoverPrimitive.Trigger>
  );
});
PopoverTrigger.displayName = "PopoverTrigger";

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    /** Title announced by screen readers when the mobile drawer opens. */
    mobileTitle?: string;
    /** Class name applied to the DrawerContent wrapper on mobile. */
    mobileClassName?: string;
  }
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      children,
      mobileTitle,
      mobileClassName,
      ...props
    },
    ref,
  ) => {
    const { isCompactViewport, open, onOpenChange } = useResponsivePopover();
    // Unconditional (rules of hooks — the compact branch returns early); the
    // compact drawer path is covered by DrawerContent's own stamp.
    const scopeProps = usePortalScopeProps();

    if (isCompactViewport) {
      // Forward DOM-level props (event handlers, data-*, aria-*) but strip
      // Radix positioning/behavior props that are meaningless for a Drawer.
      const domProps = stripRadixContentProps(props);

      return (
        <ResponsiveDrawerShell
          open={open}
          onOpenChange={onOpenChange}
          srLabel={mobileTitle ?? "Options"}
          contentClassName={mobileClassName}
          repositionInputs={false}
        >
          <div
            ref={ref}
            className={cn(
              "overflow-y-auto px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]",
              className,
            )}
            {...domProps}
          >
            {children}
          </div>
        </ResponsiveDrawerShell>
      );
    }

    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          {...scopeProps}
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-50 w-96 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

// ---------------------------------------------------------------------------
// Anchor (desktop-only positioning concept — passthrough on mobile)
// ---------------------------------------------------------------------------

const PopoverAnchor = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Anchor>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Anchor>
>(({ children, ...props }, ref) => {
  const { isCompactViewport } = useResponsivePopover();

  if (isCompactViewport) {
    return <>{children}</>;
  }

  return (
    <PopoverPrimitive.Anchor ref={ref} {...props}>
      {children}
    </PopoverPrimitive.Anchor>
  );
});
PopoverAnchor.displayName = "PopoverAnchor";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
