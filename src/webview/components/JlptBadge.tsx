import { Badge } from "./Badge";

/**
 * A JLPT level badge (N5…N1). The level is an *unofficial* community estimate — no official JLPT
 * vocabulary list has ever existed — so the badge carries a tooltip saying so, and renders nothing
 * when the word has no assigned level. Levels are stored 5 (N5, easiest) … 1 (N1, hardest).
 */
export const JlptBadge = ({
  level
}: {
  level: number | null;
}): React.ReactElement | null => {
  if (level === null) return null;
  return (
    <Badge
      kind="jlpt"
      title="JLPT level — unofficial estimate (Jonathan Waller / tanos.co.uk)"
    >
      N{level}
    </Badge>
  );
};
