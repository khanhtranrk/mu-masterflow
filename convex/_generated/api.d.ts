/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifactLinks from "../artifactLinks.js";
import type * as artifactMigration from "../artifactMigration.js";
import type * as artifactModel from "../artifactModel.js";
import type * as artifactStore from "../artifactStore.js";
import type * as artifactTransfers from "../artifactTransfers.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as http from "../http.js";
import type * as notifications from "../notifications.js";
import type * as requestArtifacts from "../requestArtifacts.js";
import type * as requestSelection from "../requestSelection.js";
import type * as requests from "../requests.js";
import type * as s3 from "../s3.js";
import type * as specs from "../specs.js";
import type * as storage from "../storage.js";
import type * as storageModel from "../storageModel.js";
import type * as transientQuery from "../transientQuery.js";
import type * as unitTokens from "../unitTokens.js";
import type * as units from "../units.js";
import type * as workerAccess from "../workerAccess.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artifactLinks: typeof artifactLinks;
  artifactMigration: typeof artifactMigration;
  artifactModel: typeof artifactModel;
  artifactStore: typeof artifactStore;
  artifactTransfers: typeof artifactTransfers;
  auth: typeof auth;
  authz: typeof authz;
  http: typeof http;
  notifications: typeof notifications;
  requestArtifacts: typeof requestArtifacts;
  requestSelection: typeof requestSelection;
  requests: typeof requests;
  s3: typeof s3;
  specs: typeof specs;
  storage: typeof storage;
  storageModel: typeof storageModel;
  transientQuery: typeof transientQuery;
  unitTokens: typeof unitTokens;
  units: typeof units;
  workerAccess: typeof workerAccess;
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
