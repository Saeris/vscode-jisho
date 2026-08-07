import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import type { Key } from "react-aria-components";
import { isTab, TABS, type Tab as TabId } from "../machines/navigation";
import styles from "./NavigationTabs.module.css";

interface NavigationTabsProps {
  selected: TabId;
  onSelect: (tab: TabId) => void;
  /** One panel per tab, keyed by id. */
  panels: Record<TabId, React.ReactNode>;
}

/**
 * The navigation root's four sections (#55): Search · Vocab · Kanji · Kana.
 *
 * The tab bar sits at the BOTTOM of the panel, where a phone app puts it and where the thumb is —
 * and, more practically here, where it cannot be confused with the search field's own toolbar at the
 * top. `TabList` is rendered after the panels in the DOM and pinned with flex order, so the reading
 * order matches the visual one.
 *
 * `shouldForceMount` on every panel is what makes a tab REMEMBER where you were. Measured: without
 * it a panel remounts on every switch (3 mounts across one there-and-back, its state reset), with it
 * each mounts exactly once and its scroll position, breadcrumb depth and in-flight queries survive.
 * That is the whole reason the machine only stores WHICH tab is active — everything else a tab
 * remembers is ordinary component state that never unmounts.
 *
 * React Aria marks the inactive panels `inert`, so nothing inside a hidden tab is focusable or
 * reachable by the keyboard; the CSS only has to hide them visually.
 */
export const NavigationTabs = ({
  selected,
  onSelect,
  panels
}: NavigationTabsProps): React.ReactElement => (
  <Tabs
    className={styles.tabs}
    selectedKey={selected}
    // React Aria's key type is `string | number`; the ids come from `TABS`, so this only ever
    // narrows a value we put there ourselves — but check rather than assert.
    onSelectionChange={(key: Key) => {
      if (isTab(key)) onSelect(key);
    }}
  >
    {TABS.map((t) => (
      <TabPanel key={t.id} id={t.id} className={styles.panel} shouldForceMount>
        {panels[t.id]}
      </TabPanel>
    ))}
    <TabList className={styles.list} aria-label="Sections">
      {TABS.map((t) => (
        <Tab key={t.id} id={t.id} className={styles.tab}>
          {t.label}
        </Tab>
      ))}
    </TabList>
  </Tabs>
);
