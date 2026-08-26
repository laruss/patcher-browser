import { withAppKeyQuery } from "./app-key";
import { apiClient, toRelativeUrl } from "./api-server";

/**
 * A URL the browser fetches as a **sub-resource** — an `<img src>`, a download
 * link. None of these passes through `fetch`, so none can carry the app key as
 * a header, and the gate accepts it in the query for exactly this reason. What
 * makes that safe here is that the fetched bytes never become a document: an
 * image cannot read the URL it was loaded from.
 */
function subResourceUrl(url: URL): string {
  return withAppKeyQuery(toRelativeUrl(url));
}

/**
 * A URL that becomes a **document** — the `src` of an HTML preview iframe.
 *
 * Deliberately unkeyed, and it must stay that way. Those iframes render
 * whatever HTML an agent wrote, under `sandbox="allow-scripts"` with no CSP:
 * script runs, and script can read `location.search`. Putting the install's
 * app key there would hand every previewed file the credential for the whole
 * local API.
 *
 * So the caller does not point an iframe at these. It fetches them through the
 * app's signed `fetch` and renders the bytes from a `blob:` URL — see
 * `useSignedObjectUrl`. This builder exists to name that path; the key is
 * added by nothing.
 */
function documentUrl(url: URL): string {
  return toRelativeUrl(url);
}

/**
 * Percent-encode each segment of a path-suffix route param. Hono's `$url()`
 * substitutes params verbatim (slashes must survive, but everything else
 * needs encoding), so `:filePath{.+}` values are encoded here.
 */
function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function buildProjectAttachmentContentUrl(
  projectId: string,
  path: string,
): string {
  return subResourceUrl(
    apiClient.projects[":id"].attachments.content.$url({
      param: { id: projectId },
      query: { path },
    }),
  );
}

export function buildProjectFileContentUrl(
  projectId: string,
  path: string,
  routing: { environmentId?: string; hostId?: string } = {},
): string {
  return subResourceUrl(
    apiClient.projects[":id"].files.content.$url({
      param: { id: projectId },
      query: { path, ...routing },
    }),
  );
}

export function buildThreadStorageContentUrl(
  threadId: string,
  path: string,
): string {
  return subResourceUrl(
    apiClient.threads[":id"]["thread-storage"].content.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildThreadStorageRawContentUrl(
  threadId: string,
  path: string,
): string {
  return documentUrl(
    apiClient.threads[":id"]["thread-storage"].files[":filePath{.+}"].$url({
      param: { id: threadId, filePath: encodePathSegments(path) },
    }),
  );
}

export function buildThreadHostFileContentUrl(
  threadId: string,
  path: string,
): string {
  return subResourceUrl(
    apiClient.threads[":id"]["host-files"].content.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildRawFilesystemHtmlContentUrl(
  threadId: string,
  path: string,
): string {
  return documentUrl(
    apiClient.threads[":id"].files.raw.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildThreadWorktreeRawContentUrl(
  threadId: string,
  path: string,
): string {
  return documentUrl(
    apiClient.threads[":id"].worktree.files[":filePath{.+}"].$url({
      param: { id: threadId, filePath: encodePathSegments(path) },
    }),
  );
}
