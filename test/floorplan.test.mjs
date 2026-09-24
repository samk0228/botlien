import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFloorplan } from "../src/floorplan.mjs";

// A 6x5 grid of 2m cells, everywhere driven, with one bad spot.
const grid = (stuckAt = { x: 6, y: 4 }, stuck = 40) => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 5; j++) {
      const gx = i * 2;
      const gy = j * 2;
      rows.push({ gx, gy, samples: 50, stuck_samples: gx === stuckAt.x && gy === stuckAt.y ? stuck : 1 });
    }
  }
  return rows;
};

test("too few cells is not a map", () => {
  assert.equal(buildFloorplan([{ gx: 0, gy: 0, samples: 9, stuck_samples: 9 }]), null);
});

test("plenty of floor but almost no stalls is not a map either", () => {
  const quiet = grid().map((c) => ({ ...c, stuck_samples: 0 }));
  assert.equal(buildFloorplan(quiet), null);
});

test("bounds and extent come back in metres", () => {
  const p = buildFloorplan(grid());
  assert.equal(p.cols, 6);
  assert.equal(p.rows, 5);
  assert.equal(p.widthMeters, 12); // 5 gaps of 2m plus the cell itself
  assert.equal(p.heightMeters, 10);
});

test("y is flipped so the map is not printed upside down", () => {
  const p = buildFloorplan(grid());
  const top = p.cells.find((c) => c.gy === p.bounds.maxY);
  const bottom = p.cells.find((c) => c.gy === p.bounds.minY);
  assert.equal(top.y, 0);
  assert.ok(bottom.y > top.y);
});

test("the worst cell carries full weight and is labelled", () => {
  const p = buildFloorplan(grid());
  assert.equal(p.hottest.gx, 6);
  assert.equal(p.hottest.gy, 4);
  assert.equal(p.hottest.weight, 1);
  assert.equal(p.hottest.label, true);
});

test("stall hours are attributed by share and sum back to the fleet figure", () => {
  const p = buildFloorplan(grid(), { stalledHours: 20 });
  const total = p.cells.reduce((n, c) => n + c.hours, 0);
  assert.ok(Math.abs(total - 20) < 1e-9);
  assert.ok(Math.abs(p.hottest.hours - 20 * p.hottest.shareOfStalls) < 1e-9);
});

test("hours are null when the caller has no stall total to attribute", () => {
  const p = buildFloorplan(grid());
  assert.equal(p.hottest.hours, null);
});

test("concentration separates one bad doorway from a bad fleet", () => {
  const concentrated = buildFloorplan(grid({ x: 6, y: 4 }, 400));
  assert.ok(concentrated.top3Share > 0.9);

  const spread = buildFloorplan(grid().map((c) => ({ ...c, stuck_samples: 5 })));
  assert.ok(spread.top3Share < 0.2);
});

test("density and share of stalls are different readings and both survive", () => {
  const rows = grid();
  // a cell barely visited but stuck almost every time it was
  rows.push({ gx: 20, gy: 20, samples: 6, stuck_samples: 5 });
  const p = buildFloorplan(rows);
  const rare = p.cells.find((c) => c.gx === 20);
  assert.ok(rare.density > 0.8, "nearly always stuck when it goes there");
  assert.ok(rare.shareOfStalls < 0.1, "yet a small slice of the whole burden");
});

test("cells with no coordinates never reach the geometry", () => {
  const rows = [...grid(), { gx: null, gy: 3, samples: 90, stuck_samples: 9 }];
  const p = buildFloorplan(rows);
  assert.ok(p.cells.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
});
