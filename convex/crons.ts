import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Pairing codes nobody finished (an approved one holds a token until its runner polls) and spent rate-limit windows.
crons.interval("sweep pairing", { hours: 1 }, internal.machines.sweep, {});
// Folder scans and listings past their ten minutes (each also has its own scheduled delete).
crons.interval("sweep folder requests", { minutes: 5 }, internal.folders.sweep, {});

export default crons;
