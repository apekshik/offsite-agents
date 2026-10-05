/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crew from "../crew.js";
import type * as crewlib from "../crewlib.js";
import type * as diffs from "../diffs.js";
import type * as flow from "../flow.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as machines from "../machines.js";
import type * as messages from "../messages.js";
import type * as offices from "../offices.js";
import type * as questions from "../questions.js";
import type * as repolib from "../repolib.js";
import type * as repos from "../repos.js";
import type * as runner from "../runner.js";
import type * as runs from "../runs.js";
import type * as tasks from "../tasks.js";
import type * as threads from "../threads.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";
import type * as world from "../world.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crew: typeof crew;
  crewlib: typeof crewlib;
  diffs: typeof diffs;
  flow: typeof flow;
  http: typeof http;
  lib: typeof lib;
  machines: typeof machines;
  messages: typeof messages;
  offices: typeof offices;
  questions: typeof questions;
  repolib: typeof repolib;
  repos: typeof repos;
  runner: typeof runner;
  runs: typeof runs;
  tasks: typeof tasks;
  threads: typeof threads;
  tools: typeof tools;
  users: typeof users;
  world: typeof world;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
