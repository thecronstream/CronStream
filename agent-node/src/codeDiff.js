/**
 * codeDiff.js
 * Shared "is this a real code change?" check for milestone verification.
 *
 * A merged PR counts as a deliverable if it adds real code — regardless of where
 * the repo keeps that code. We use a DENYLIST (not a `src/`+`contracts/`
 * allowlist) so it works for every project layout and every developer's
 * workflow: Go in cmd/, Python at root, JS in lib/ or packages/, etc.
 *
 * A file is NOT counted when it is documentation, lockfiles, CI config, build
 * config, or binary assets — changes to those alone shouldn't trigger payment.
 */

const DOC_EXTS = new Set([
  '.md', '.txt', '.mdx', '.rst', '.adoc',
]);

const ASSET_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.mov', '.webm', '.pdf',
]);

// Build/CI/config formats — a PR touching only these isn't a code deliverable.
const CONFIG_EXTS = new Set([
  '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.lock', '.env', '.editorconfig', '.log', '.map', '.snap',
]);

// Non-code metadata files that have no extension.
const IGNORE_BASENAMES = new Set([
  'license', 'copying', 'notice', 'authors', 'codeowners', 'changelog',
]);

/**
 * @param {string} filename - path as reported by the provider (e.g. "agent-node/src/db.js")
 * @returns {boolean} true if the change should count toward a milestone
 */
export function isQualifyingCodeFile(filename) {
  if (!filename) return false;
  const path = filename.toLowerCase();

  // CI / workflow definitions never count on their own.
  if (path.startsWith('.github/') || path.includes('/.github/')) return false;

  const base = path.split('/').pop();
  if (!base) return false;

  // Dotfiles (.gitignore, .env, .prettierrc, .babelrc, …) are config by convention.
  if (base.startsWith('.')) return false;
  if (IGNORE_BASENAMES.has(base)) return false;
  if (base.endsWith('.lock')) return false;

  const lastDot = base.lastIndexOf('.');
  const ext = lastDot >= 0 ? base.slice(lastDot) : '';
  if (DOC_EXTS.has(ext) || ASSET_EXTS.has(ext) || CONFIG_EXTS.has(ext)) return false;

  // Everything else (.js .ts .tsx .sol .py .go .rs .java .rb .php .c .cpp .sh,
  // Dockerfile, Makefile, …) is real code.
  return true;
}
