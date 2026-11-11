/**
 * Custom properties in a `style` prop. A component that hands CSS a number (the overprint's layer
 * index and ink, spec 22) sets it as `--name`, and CSS reads it through `var()`; React passes such
 * keys through, but its types know only the standard properties. Declared once here so no call
 * site needs a cast.
 *
 * A module (the import), so this augments React's types rather than replacing them.
 */
import "react";

declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
