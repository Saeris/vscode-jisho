import { describe, expect, it } from "vitest";
import {
  completeMap,
  endPointDistance,
  getMap,
  initialDistance,
  wholeWholeDistance
} from "../correspondence";
import type { Pattern, Stroke } from "../types";

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

describe("distance metrics (hand-derived expectations)", () => {
  // Small strokes with hand-computable distances. The metrics are the primitives the map + ranking
  // rest on — a transcription error here doesn't crash, it silently reorders candidates (exactly
  // the kind of bug the k1/k2 fidelity failure was). Manhattan = |dx| + |dy|.
  const a: Stroke = [
    [0, 0],
    [10, 0]
  ];
  const b: Stroke = [
    [0, 5],
    [10, 5]
  ];

  it("endPointDistance sums first↔first and last↔last Manhattan distances", () => {
    // first: |0-0|+|0-5| = 5; last: |10-10|+|0-5| = 5 → 10.
    expect(endPointDistance(a, b)).toBe(10);
  });

  it("endPointDistance is 0 when either stroke is empty", () => {
    expect(endPointDistance([], b)).toBe(0);
    expect(endPointDistance(a, [])).toBe(0);
  });

  it("initialDistance sums point-wise over the shorter, scaled by the length ratio", () => {
    // equal length (2 each): |0|+|5| + |0|+|5| = 10, ratio 2/2 = 1 → 10.
    expect(initialDistance(a, b)).toBe(10);
    // shorter b2 (1 point) vs a (2 points): pointwise |0|+|5| = 5, scaled ×(2/1) = 10.
    const b2: Stroke = [[0, 5]];
    expect(initialDistance(a, b2)).toBe(10);
  });

  it("wholeWholeDistance averages proportional-index Manhattan distances", () => {
    // Same length: for i=0 j=0 (|0|+|5|=5), i=1 j=1 (|0|+|5|=5); sum 10, /2 → 5.
    expect(wholeWholeDistance(a, b)).toBe(5);
  });

  it("distance metrics are symmetric in their argument order where the algorithm assumes it", () => {
    // endPoint + wholeWhole are order-independent (they internally sort by size); the map relies on
    // this so swapping input/reference doesn't change the score.
    expect(endPointDistance(a, b)).toBe(endPointDistance(b, a));
    expect(wholeWholeDistance(a, b)).toBe(wholeWholeDistance(b, a));
  });
});
