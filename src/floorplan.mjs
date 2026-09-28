/** Where the robots work, and where they get stuck.
 *
 *  The stall tip already names the worst spot in words and prices it. Words are
 *  enough to make an owner nod. They are not enough to make anyone walk out to
 *  the aisle, because "around x 12, y -4 on its map" is not a place a human
 *  knows. This turns the same numbers into a picture of their own floor.
 *
 *  Two layers, from one query:
 *    ground   every cell the fleet was seen in, faint. This is the floor: the
 *             shape falls out of where the robots actually drive, so no floor
 *             plan upload is ever needed.
 *    stalls   cells where they were stuck, weighted by how much stall time
 *             landed there.
 *
 *  Deliberately monochrome. The page carries no status colours anywhere (see
 *  the note at the top of OWNER_CSS), so density is carried by ink opacity and
 *  radius, never by a red-to-green ramp. It also survives being printed and
 *  handed to a shift lead, which is the actual use.
 */

/** Cells below this share of the worst cell are drawn but not labelled, so the
 *  map does not turn into a wall of numbers over every faint smudge. */
const LABEL_FLOOR = 0.45;

const HOUR_MS = 3_600_000;

/** Build the render model. Pure: takes rows out of the store and returns
 *  geometry, so it can be tested without a database or a browser.
 *
 *  Returns null when there is nothing honest to draw. A map of two cells is not
 *  a map, it is a decoration that implies we know the floor when we do not. */
export function buildFloorplan(rows, { gridMeters = 2, minCells = 8, minStuck = 12, stalledHours = null } = {}) {
  const cells = (rows ?? []).filter((r) => Number.isFinite(r.gx) && Number.isFinite(r.gy) && r.samples > 0);
  if (cells.length < minCells) return null;

  const stuckTotal = cells.reduce((n, c) => n + (c.stuck_samples ?? 0), 0);
  if (stuckTotal < minStuck) return null;

  const xs = cells.map((c) => c.gx);
  const ys = cells.map((c) => c.gy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const worstStuck = Math.max(...cells.map((c) => c.stuck_samples ?? 0));
  const busiest = Math.max(...cells.map((c) => c.samples));

  // SVG y grows downward and a robot's map grows upward, so y is flipped here
  // rather than in the template. A map printed upside down relative to the
  // floor is worse than no map: someone walks to the wrong end of the building.
  const place = (c) => ({
    x: (c.gx - minX) / gridMeters,
    y: (maxY - c.gy) / gridMeters,
  });

  const built = cells.map((c) => {
    const stuck = c.stuck_samples ?? 0;
    const weight = worstStuck > 0 ? stuck / worstStuck : 0;
    return {
      ...place(c),
      gx: c.gx,
      gy: c.gy,
      samples: c.samples,
      stuck,
      // Share of the fleet's whole stall burden that landed in this one cell.
      shareOfStalls: stuckTotal > 0 ? stuck / stuckTotal : 0,
      // How much of the time spent in this cell was spent stuck. A cell can be
      // a small share of all stalls and still be a rotten spot to drive through.
      density: c.samples > 0 ? stuck / c.samples : 0,
      presence: busiest > 0 ? c.samples / busiest : 0,
      weight,
      label: weight >= LABEL_FLOOR,
      // Stall hours attributed to this cell, when the caller knows the fleet's
      // total. Same conversion as everywhere else: a share of samples is a fair
      // reading of a share of time.
      hours: stalledHours !== null && stuckTotal > 0 ? (stuck / stuckTotal) * stalledHours : null,
    };
  });

  const hot = built.filter((c) => c.stuck > 0).sort((a, b) => b.stuck - a.stuck);

  return {
    gridMeters,
    cols: (maxX - minX) / gridMeters + 1,
    rows: (maxY - minY) / gridMeters + 1,
    bounds: { minX, maxX, minY, maxY },
    widthMeters: maxX - minX + gridMeters,
    heightMeters: maxY - minY + gridMeters,
    cells: built,
    hot,
    hottest: hot[0] ?? null,
    stuckTotal,
    // How concentrated the trouble is. One number the owner can act on: 60% in
    // three cells means go look at three places, evenly spread means the
    // problem is the robots or the traffic, not the building.
    top3Share: hot.slice(0, 3).reduce((n, c) => n + c.shareOfStalls, 0),
  };
}

/** Convert a fleet stall-hours figure into per-cell hours for the caption. */
export function cellHours(cell, stalledHours) {
  if (stalledHours === null || !cell) return null;
  return cell.shareOfStalls * stalledHours;
}

export { HOUR_MS };
