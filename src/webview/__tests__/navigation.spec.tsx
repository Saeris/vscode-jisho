import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeNavigation, NavigationProvider, useNavigate } from "../navigation";
import type { NavEvent } from "../machines/navigation";

describe("makeNavigation", () => {
  it("maps every action onto its machine event", () => {
    // WHY: this layer exists so a view says what it wants ("openKanji") instead of hand-writing the
    // event a machine expects. If a mapping is wrong the view navigates somewhere else entirely, and
    // no type error catches it — both sides are just strings in an object.
    const sent: NavEvent[] = [];
    const nav = makeNavigation((event) => sent.push(event), true);

    nav.openWord("1358280");
    nav.openMoreExamples("1358280");
    nav.openKanji("水");
    nav.openStrokeOrder("水");
    nav.openComponentTree("願");
    nav.openName("5543705");
    nav.openRadicals(["氵"]);
    nav.openHandwriting();
    nav.openAbout();
    nav.back();
    nav.home?.();
    nav.searchFor("食べる");
    nav.appendToSearch("水");
    nav.setSearchQuery("water");

    expect(sent).toEqual([
      { type: "openWord", id: "1358280" },
      { type: "openMoreExamples", id: "1358280" },
      { type: "openKanji", literal: "水" },
      { type: "openStrokeOrder", literal: "水" },
      { type: "openComponentTree", literal: "願" },
      { type: "openName", id: "5543705" },
      { type: "openRadicals", preselect: ["氵"] },
      { type: "openHandwriting" },
      { type: "openAbout" },
      { type: "back" },
      { type: "home" },
      { type: "searchFor", term: "食べる" },
      { type: "appendToSearch", char: "水" },
      { type: "setSearchQuery", query: "water" }
    ]);
  });

  it("omits home when it would duplicate back", () => {
    // WHY: at one level deep, Home and Back do the same thing — offering both is a second button
    // that appears to do something different and does not. `undefined` lets headers omit it.
    expect(
      makeNavigation(vi.fn<(event: NavEvent) => void>(), false).home
    ).toBeUndefined();
    expect(
      makeNavigation(vi.fn<(event: NavEvent) => void>(), true).home
    ).toBeDefined();
  });

  it("passes an omitted radical preselection through as undefined", () => {
    const sent: NavEvent[] = [];
    makeNavigation((event) => sent.push(event), false).openRadicals();
    expect(sent).toEqual([{ type: "openRadicals", preselect: undefined }]);
  });
});

describe("useNavigate", () => {
  it("reaches the provider from a nested component", async () => {
    const send = vi.fn<(event: NavEvent) => void>();
    const Deep = (): React.ReactElement => {
      const nav = useNavigate();
      return <button onClick={() => nav.openKanji("水")}>go</button>;
    };
    render(
      <NavigationProvider send={send} canGoHome={false}>
        <div>
          <Deep />
        </div>
      </NavigationProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(send).toHaveBeenCalledWith({ type: "openKanji", literal: "水" });
  });

  it("throws outside a provider rather than silently not navigating", () => {
    // WHY: a no-op default would make a view a dead end the user has to restart the panel to escape,
    // and it would pass any test that never clicks. Failing at render is louder and cheaper.
    const Orphan = (): React.ReactElement => {
      useNavigate();
      return <p>unreachable</p>;
    };
    expect(() => render(<Orphan />)).toThrow(/NavigationProvider/);
  });
});
