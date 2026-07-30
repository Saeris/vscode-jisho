import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import type { NavEvent } from "../machines/navigation";
import { NavigationProvider } from "../navigation";

/**
 * Render a component inside a navigation provider, returning the spy the provider dispatches through.
 *
 * Views take their navigation from context rather than props now, so a bare `render` throws — which
 * is deliberate (see `useNavigate`). This keeps every view spec's setup to one line and gives them a
 * uniform way to assert navigation: check what was SENT, not which callback prop fired.
 */
export const renderWithNavigation = (
  ui: React.ReactElement,
  { canGoHome = false }: { canGoHome?: boolean } = {}
): RenderResult & { sent: NavEvent[] } => {
  const sent: NavEvent[] = [];
  const result = render(
    <NavigationProvider
      send={(event) => sent.push(event)}
      canGoHome={canGoHome}
    >
      {ui}
    </NavigationProvider>
  );
  return { ...result, sent };
};

/** A no-op navigation send, for specs that only care that a component renders. */
export const noopSend = (): ((event: NavEvent) => void) =>
  vi.fn<(event: NavEvent) => void>();
