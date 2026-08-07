import { Activity, useEffect } from "react";
import { useMachine } from "@xstate/react";
import { onHostPush, persistState, readPersistedState } from "./bridge";
import { NavigationProvider } from "./navigation";
import { speak } from "./speech";
import {
  activeView,
  canGoForward,
  canGoHome,
  navigationMachineFrom
} from "./machines/navigation";
import { NavigationTabs } from "./components/NavigationTabs";
import { About } from "./views/About";
import { Browse, BrowseTab } from "./views/Browse";
import { ComingSoon } from "./views/ComingSoon";
import { KanjiBrowse } from "./views/KanjiBrowse";
import { WordList } from "./views/WordList";
import { Handwriting } from "./views/Handwriting";
import { KanjiDetail } from "./views/KanjiDetail";
import { MoreExamples } from "./views/MoreExamples";
import { NameDetail } from "./views/NameDetail";
import { RadicalPicker } from "./views/RadicalPicker";
import { ComponentTree } from "./views/ComponentTree";
import { SearchResults } from "./views/SearchResults";
import { StrokeOrder } from "./views/StrokeOrder";
import { WordDetail } from "./views/WordDetail";

/**
 * Built once, at module scope rather than per render: the persisted state is what the PREVIOUS
 * incarnation of this document left behind and cannot change while we are running, and re-seeding a
 * machine mid-session would throw away live navigation.
 */
const machine = navigationMachineFrom(readPersistedState(), persistState);

export const App = (): React.ReactElement => {
  const [state, send] = useMachine(machine);
  const view = activeView(state.context);

  // Editor commands arrive as host pushes: "Look Up Selection" searches (and navigates to the
  // search view), "Speak Selection" goes straight to TTS. An external event subscription is the
  // one legitimate useEffect.
  useEffect(
    () =>
      onHostPush((push) => {
        if (push.action === "search")
          send({ type: "searchFor", term: push.text });
        else void speak(push.text);
      }),
    [send]
  );

  // Back/forward mouse buttons (X1/X2). Another external subscription, and the second legitimate
  // useEffect: these are window-level events with no React element to attach to — the buttons
  // should work anywhere in the panel, not only over some focused control.
  //
  // `auxclick` rather than `mouseup`: it is the event the platform defines for non-primary buttons,
  // and it fires once per click rather than for every press and release. Verified in the Electron
  // webview — the buttons arrive as `button` 3 and 4, so no host-side keybinding fallback is needed
  // (which the backlog item flagged as a risk).
  useEffect(() => {
    const onAuxClick = (event: MouseEvent): void => {
      if (event.button !== 3 && event.button !== 4) return;
      // Chromium would otherwise ALSO traverse the webview document's own session history, which
      // is not ours and would navigate the panel away from the app.
      event.preventDefault();
      send({ type: event.button === 3 ? "back" : "forward" });
    };
    window.addEventListener("auxclick", onAuxClick);
    return (): void => window.removeEventListener("auxclick", onAuxClick);
  }, [send]);
  return (
    // The Home escape hatch is only offered when it differs from Back (drilled >1 level deep); the
    // provider turns that into `home` being undefined, so headers omit the control rather than
    // rendering a second button that does what Back already does.
    <NavigationProvider
      send={send}
      canGoHome={canGoHome(state.context)}
      canGoForward={canGoForward(state.context)}
    >
      {/* The navigation ROOT (#55): four sections you switch between, not four views you navigate
          to. It stays mounted inside an <Activity> when a detail view is pushed on top, so scroll
          position, list state and in-flight queries all survive Back natively — and because the
          tab panels inside are force-mounted, that preservation reaches each individual tab. The
          machine stays the source of truth for WHICH view is active and which tab is showing.

          The bar is deliberately absent above depth 1: on a word or kanji page the tabs are
          irrelevant chrome, and Home is the way back to whichever one you left. */}
      <Activity mode={view.name === "search" ? "visible" : "hidden"}>
        <NavigationTabs
          selected={state.context.tab}
          onSelect={(tab) => send({ type: "selectTab", tab })}
          panels={{
            search: (
              <SearchResults
                query={state.context.searchQuery}
                selectedSegment={state.context.selectedSegment}
              />
            ),
            vocab: <BrowseTab />,
            kanji: <KanjiBrowse />,
            kana: (
              <ComingSoon
                title="Kana"
                detail="The hiragana and katakana charts are on the way."
              />
            )
          }}
        />
      </Activity>
      {view.name === "wordDetail" ? <WordDetail id={view.id} /> : null}
      {view.name === "moreExamples" ? <MoreExamples id={view.id} /> : null}
      {view.name === "kanjiDetail" ? (
        <KanjiDetail literal={view.literal} />
      ) : null}
      {view.name === "componentTree" ? (
        <ComponentTree
          literal={view.literal}
          onOpenKanji={(literal) => send({ type: "openKanji", literal })}
        />
      ) : null}
      {view.name === "strokeOrder" ? (
        <StrokeOrder
          literal={view.literal}
          onOpenKanji={(literal) => send({ type: "openKanji", literal })}
          onFindByPart={(preselect) =>
            send({ type: "openRadicals", preselect })
          }
        />
      ) : null}
      {view.name === "nameDetail" ? <NameDetail id={view.id} /> : null}
      {/* Keyed on the group so drilling from the tree to a group remounts rather than reusing the
          previous level's scroll position. */}
      {view.name === "browse" ? (
        <Browse key={view.group ?? ""} group={view.group} />
      ) : null}
      {view.name === "wordList" ? (
        <WordList key={view.id} id={view.id} />
      ) : null}
      {view.name === "radicals" ? (
        <RadicalPicker
          // Remount when the preselection changes: the picker seeds its local selection from this
          // prop, so a plain re-render would keep the previous view's selection.
          key={view.preselect?.join("") ?? ""}
          preselect={view.preselect}
          onBack={() => send({ type: "back" })}
          onOpenKanji={(literal) => send({ type: "openKanji", literal })}
        />
      ) : null}
      {view.name === "handwriting" ? <Handwriting /> : null}
      {view.name === "about" ? <About /> : null}
    </NavigationProvider>
  );
};
