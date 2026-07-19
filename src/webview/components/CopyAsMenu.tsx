import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover
} from "react-aria-components";
import { toRomaji } from "wanakana";
import { toRubyHtml, toRubyMarkdown } from "../../shared/ruby";
import { useCopyStatus } from "./useCopyStatus";
import styles from "./CopyButton.module.css";
import menuStyles from "./CopyAsMenu.module.css";

interface CopyAsMenuProps {
  /** The word as written — the kanji spelling when there is one. */
  headword: string;
  /** Its primary kana reading; "" when unknown. */
  reading: string;
}

/**
 * "Copy as…" for a word: the same text in the shapes an author actually needs — plain, reading,
 * romaji, and furigana in both mirrordown ruby markdown and HTML. Ruby variants annotate only the
 * kanji ({食|た}べる), which is why they're worth offering: hand-writing that markup is tedious and
 * error-prone.
 */
export const CopyAsMenu = ({
  headword,
  reading
}: CopyAsMenuProps): React.ReactElement => {
  const { status, copy } = useCopyStatus();
  // A kana-only word has nothing to annotate; offering ruby variants would just repeat the word.
  const hasRuby = reading !== "" && headword !== reading;

  const items: Array<{ id: string; label: string; value: string }> = [
    { id: "word", label: "Word", value: headword },
    ...(reading === ""
      ? []
      : [
          { id: "reading", label: "Reading", value: reading },
          { id: "romaji", label: "Romaji", value: toRomaji(reading) }
        ]),
    ...(hasRuby
      ? [
          {
            id: "ruby-md",
            label: "Furigana (Markdown)",
            value: toRubyMarkdown(headword, reading)
          },
          {
            id: "ruby-html",
            label: "Furigana (HTML)",
            value: toRubyHtml(headword, reading)
          }
        ]
      : [])
  ];

  return (
    <MenuTrigger>
      <Button
        className={styles.copy}
        aria-label={`Copy ${headword} as…`}
        data-status={status}
      >
        <span aria-hidden="true">⧉</span>
        {/* aria-live so the outcome is announced, not just shown. */}
        <span className={styles.feedback} role="status" aria-live="polite">
          {status === "copied" ? "Copied" : status === "failed" ? "Failed" : ""}
        </span>
      </Button>
      <Popover className={menuStyles.popover}>
        <Menu
          className={menuStyles.menu}
          onAction={(key) => {
            const item = items.find((entry) => entry.id === key);
            if (item) void copy(item.value);
          }}
        >
          {items.map((item) => (
            <MenuItem key={item.id} id={item.id} className={menuStyles.item}>
              <span className={menuStyles.itemLabel}>{item.label}</span>
              <span className={menuStyles.itemValue} lang="ja">
                {item.value}
              </span>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
};
