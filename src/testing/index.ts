/**
 * The supported TEST KIT, exported from the `./testing` subpath so importing the
 * client never pulls it into a Worker bundle.
 */
export { fakeFetch } from "./fake-fetch.js";
export type { CannedResponse, CapturedRequest, FakeFetch } from "./fake-fetch.js";
export { cassetteClient } from "./cassette.js";
export type { CassetteClient, CassetteEntry } from "./cassette.js";
