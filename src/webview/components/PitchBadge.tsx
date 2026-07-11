import { Badge } from "./Badge";

/**
 * Pitch accent notation for a reading, in the compact numeric form (mora position of the downstep;
 * 0 = heiban/flat). A reading can have several accepted patterns, ordered by commonness. Renders
 * nothing when no accent data is known. The graphical overline/downstep rendering is a later
 * follow-up; the number is the standard dictionary shorthand learners recognize.
 */
export const PitchBadge = ({
  accents
}: {
  accents: number[];
}): React.ReactElement | null => {
  if (accents.length === 0) return null;
  return (
    <Badge kind="pitch" title="Pitch accent (downstep mora; 0 = flat)">
      {accents.join("・")}
    </Badge>
  );
};
