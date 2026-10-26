import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

// Styling lives in styles/components/_controls.scss (.ui-tooltip*).
//
// One TooltipProvider sits at the app root (App.jsx). Its skip delay is what
// makes a row of icon buttons feel right: the first tooltip waits, moving to
// the neighbour shows the next one at once.
const OPEN_DELAY_MS = 400;
const SKIP_DELAY_MS = 300;

// Radix throws when a Tooltip renders outside a provider. Surfaces mounted
// outside App (an extension preview, an isolated test render) still get a
// working tooltip: Tooltip below supplies a provider when none is in scope.
const HasProvider = React.createContext(false);

function TooltipProvider({ children, ...props }) {
  return (
    <TooltipPrimitive.Provider delayDuration={OPEN_DELAY_MS} skipDelayDuration={SKIP_DELAY_MS} {...props}>
      <HasProvider.Provider value>{children}</HasProvider.Provider>
    </TooltipPrimitive.Provider>
  );
}

function Tooltip(props) {
  const root = <TooltipPrimitive.Root {...props} />;
  return React.useContext(HasProvider) ? root : <TooltipProvider>{root}</TooltipProvider>;
}

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn('ui-tooltip', className)}
      {...props}
    >
      {children}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * The everyday tooltip: wrap one focusable element.
 *
 *   <Tip content="Restart service" shortcut="R"><IconButton … /></Tip>
 *
 * `content` is a short label, not a paragraph. A disabled button never fires
 * pointer events, so wrap it in a span if its tooltip explains why it is off.
 * With no `content` the child renders untouched.
 */
function Tip({ content, shortcut, side = 'top', align = 'center', delayDuration, children }) {
  if (!content) return children;
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        <span>{content}</span>
        {shortcut && <kbd className="ui-tooltip__kbd">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Tip };
