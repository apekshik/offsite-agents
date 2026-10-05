import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Pairing codes nobody finished (an approved one holds a token until its runner polls) and spent rate-limit windows.
crons.interval("sweep pairing", { hours: 1 }, internal.machines.sweep, {});

export default crons;
