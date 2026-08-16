import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The real page, read from disk.
 *
 * DOM tests mount this rather than a fixture, so renaming an element id in the
 * markup without updating the code fails the suite instead of the deployed
 * page. Resolved from the working directory because under the jsdom
 * environment `import.meta.url` is not a file: URL.
 */
export const INDEX_HTML = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
