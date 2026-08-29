/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as aiDiagnostics from "../aiDiagnostics.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as files from "../files.js";
import type * as generation from "../generation.js";
import type * as lib_sha256 from "../lib/sha256.js";
import type * as plans from "../plans.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as subscriptions from "../subscriptions.js";
import type * as users from "../users.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  aiDiagnostics: typeof aiDiagnostics;
  artifacts: typeof artifacts;
  auth: typeof auth;
  billing: typeof billing;
  files: typeof files;
  generation: typeof generation;
  "lib/sha256": typeof lib_sha256;
  plans: typeof plans;
  seed: typeof seed;
  sessions: typeof sessions;
  subscriptions: typeof subscriptions;
  users: typeof users;
  worker: typeof worker;
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
