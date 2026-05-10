#!/usr/bin/env node

const { dedupeQueue, inspectQueue } = require("../src/intakeQueue");

const command = process.argv[2] || "inspect";

try {
  if (command === "inspect") {
    const summary = inspectQueue();
    console.log(
      JSON.stringify(
        {
          queuePath: summary.queuePath,
          total: summary.total,
          statusCounts: summary.statusCounts,
        },
        null,
        2
      )
    );
  } else if (command === "dedupe") {
    console.log(JSON.stringify(dedupeQueue(), null, 2));
  } else {
    console.error("Usage: node scripts/intake-queue.js <inspect|dedupe>");
    process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
