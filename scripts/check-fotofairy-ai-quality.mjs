#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const icon = ok ? "✓" : "✗";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

const app = await readFile("src/routes/app.tsx", "utf8");
const duplicate = await readFile("src/lib/dumpdeck/pipeline/duplicate-clustering.ts", "utf8");
const organization = await readFile("src/lib/dumpdeck/pipeline/organization.ts", "utf8");

check(
  "completed scans render canonical Scanned X of Y label",
  app.includes(
    "scanState.complete\n    ? `Scanned ${scanState.scannedCount} of ${scanState.totalCount} photo",
  ),
  "prevents stale Scanned 0/N headings",
);
check(
  "duplicate review initializes from suggested best",
  app.includes("g.suggestedBestPhotoId || g.photos[0].id") &&
    app.includes("p.id === g.suggestedBestPhotoId"),
);
check(
  "duplicate best selection uses quality score",
  duplicate.includes("function duplicateBestScore") && duplicate.includes("compareDuplicateBest"),
);
check(
  "near-duplicate grouping requires strong visual context",
  duplicate.includes("strongPixelComposition") && duplicate.includes("strongContext"),
);
check(
  "organization uses middle-ground confidence thresholds",
  organization.includes("const EVENT_CONFIDENCE_THRESHOLD = 0.54") &&
    organization.includes("const COLLECTION_CONFIDENCE_THRESHOLD = 0.62"),
);
check(
  "organization avoids relationship labels",
  !/Couple Photos|Friends at Dinner|subject\.add\("couple"\)|subject\.add\("friends"\)/.test(
    organization,
  ),
);
check(
  "weak organization groups recover same-moment subclusters",
  organization.includes("splitWeakGroups") &&
    organization.includes("recoverSubgroups") &&
    organization.includes("sameMomentSignal"),
);
check(
  "standalone photos render as compact Other Photos",
  app.includes("Other Photos") && app.includes("standalonePhotos"),
);
check(
  "generic Camera Roll Highlights fallback removed",
  !organization.includes('"Camera Roll Highlights"') && !app.includes('"Camera Roll Highlights"'),
);
check(
  "generic grouping explanation removed",
  !organization.includes("shared visual and semantic context"),
);

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`\n${failed.length} FotoFairy AI quality regression check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nFotoFairy AI quality regression checks passed.");
}
