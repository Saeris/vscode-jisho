import { describe, expect, it } from "vitest";
import { completeMap, endPointDistance, getMap } from "../correspondence";
import type { Pattern } from "../types";

// Reference test vectors ported verbatim from the KanjiCanvas source (the commented `testMap`
// block in kanji-canvas.js). These pin the one-to-one stroke-correspondence behaviour: the source
// documents the exact expected N-stroke and completed M–N maps, so our functional rewrite must
// reproduce them exactly. This is the algorithm's own fidelity harness.
const test_k2: Pattern = [
  [
    [0, 10],
    [30, 10],
    [60, 10]
  ],
  [
    [170, 10],
    [200, 10],
    [220, 10]
  ]
];
const test_k21: Pattern = [
  [
    [10, 15],
    [30, 15],
    [50, 15]
  ],
  [
    [50, 15],
    [55, 15],
    [60, 15]
  ],
  [
    [170, 15],
    [175, 15],
    [180, 15]
  ],
  [
    [180, 15],
    [220, 15]
  ]
];
const test_k22: Pattern = [
  [
    [0, 15],
    [40, 15]
  ],
  [
    [40, 15],
    [50, 15]
  ],
  [
    [50, 15],
    [50, 15]
  ],
  [
    [170, 15],
    [220, 15]
  ]
];
const test_k23: Pattern = [
  [
    [0, 15],
    [60, 15]
  ],
  [
    [170, 15],
    [180, 15]
  ],
  [
    [180, 15],
    [190, 15]
  ],
  [
    [170, 15],
    [220, 15]
  ]
];

describe("stroke correspondence (ported reference fidelity tests)", () => {
  it("maps test_k21 → test_k2 as the source documents", () => {
    // Source comment: initStrokeMap/getMap give [0,-1,-1,1]; completeMap → [0,0,1,1].
    let map = getMap(test_k21, test_k2, endPointDistance);
    expect(map).toEqual([0, -1, -1, 1]);
    map = completeMap(test_k21, test_k2, endPointDistance, map);
    expect(map).toEqual([0, 0, 1, 1]);
  });

  it("maps test_k22 → test_k2 as the source documents", () => {
    // Source comment: getMap → [0,-1,-1,1]; completeMap → [0,0,0,1].
    let map = getMap(test_k22, test_k2, endPointDistance);
    expect(map).toEqual([0, -1, -1, 1]);
    map = completeMap(test_k22, test_k2, endPointDistance, map);
    expect(map).toEqual([0, 0, 0, 1]);
  });

  it("maps test_k23 → test_k2 as the source documents", () => {
    // Source comment: getMap → [0,-1,-1,1]; completeMap → [0,1,1,1].
    let map = getMap(test_k23, test_k2, endPointDistance);
    expect(map).toEqual([0, -1, -1, 1]);
    map = completeMap(test_k23, test_k2, endPointDistance, map);
    expect(map).toEqual([0, 1, 1, 1]);
  });
});
