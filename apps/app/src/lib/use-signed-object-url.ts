import { useEffect, useState } from "react";

/**
 * Fetch a Patcher API resource and hand back a `blob:` URL for it.
 *
 * This exists for one job: the HTML preview iframes. They render whatever an
 * agent wrote, under `sandbox="allow-scripts"` and with no CSP, so script runs
 * inside them — and script can read the URL its own document was loaded from.
 * Pointing such an iframe straight at `/api/v1/...?appKey=<key>` would hand
 * every previewed file the credential for the whole local API, which is
 * strictly worse than the unauthenticated state this gate replaced.
 *
 * A `blob:` URL carries no credential. The bytes are fetched here, by the app,
 * through the patched `window.fetch` that signs `/api/v1` with a header
 * (`app-key-fetch.ts`) — so the request is identified and the document is not.
 *
 * The cost, stated because it is real: a blob has no directory, so HTML that
 * references a sibling file by a relative path will not resolve it. That was
 * already true the moment the API started requiring identity — the iframe's
 * own sub-resource loads never carried the key either — so this changes where
 * multi-file previews break, not whether they do. Fixing that needs a
 * per-resource token the sub-resource requests can carry.
 */
export function useSignedObjectUrl(url: string | null): {
  objectUrl: string | null;
  failed: boolean;
} {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url === null) {
      setObjectUrl(null);
      setFailed(false);
      return;
    }
    let created: string | null = null;
    // Not an AbortController alone: the fetch can settle after the effect is
    // torn down, and a blob created then would leak for the life of the
    // document. The flag decides whether to keep it or revoke it immediately.
    let live = true;
    const controller = new AbortController();
    setObjectUrl(null);
    setFailed(false);

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        created = URL.createObjectURL(blob);
        if (!live) {
          URL.revokeObjectURL(created);
          return;
        }
        setObjectUrl(created);
      } catch {
        // Abort lands here too, and a torn-down effect has nobody to tell.
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
      controller.abort();
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [url]);

  return { objectUrl, failed };
}
