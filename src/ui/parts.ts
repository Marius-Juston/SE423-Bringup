// Parts of the game that are fetched when they are first needed (a screen,
// the code level's editor and simulator, a figure): fetching one once, and
// what to do when it is not there.

const RELOADED_AT = "bringup-reloaded-at";
let reloading = false;

/**
 * A part of the game could not be fetched. The usual cause: the game was updated while this window
 * was open, so the files of the version it runs are gone from the server and from the offline copy
 * (the service worker of the new version removes the old one's). A reload fetches the new version,
 * on the same screen; code typed a moment ago is saved as the page goes. Once only: when a reload
 * did not help, or there is no network, the error is shown instead. Returns whether it reloads.
 */
export function partMissing(): boolean {
  if (reloading) return true;
  try {
    if (navigator.onLine === false) return false;
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 30_000) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return false;
  }
  reloading = true;
  window.location.reload();
  return true;
}

/** True for the error of a part that could not be fetched (each browser words it differently). */
export const isPartError = (e: unknown): boolean => /dynamically imported module|module script failed|error loading dynamically|Unable to preload/i.test(String((e as Error | null)?.message ?? e));

/** A failed fetch is tried again when it is asked for after this long, ms. */
const RETRY_AFTER_MS = 1000;

/**
 * Fetches a part once: every caller gets the same promise. A failed fetch reloads the page when
 * that can help (partMissing). Otherwise the failure is kept for a moment, so that a screen which
 * asks again while it is drawn gets the same error and shows it, and a later press tries again.
 */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  let failedAt = 0;
  return () => {
    if (pending && failedAt && Date.now() - failedAt > RETRY_AFTER_MS) pending = null;
    if (!pending) {
      failedAt = 0;
      pending = load().catch((e: unknown) => {
        failedAt = Date.now();
        // The page is about to reload: leave the screen as it is until then.
        if (partMissing()) return new Promise<T>(() => {});
        throw e;
      });
      // A component reads the part with React's use(). use() returns at once, without suspending, for a promise
      // that carries its result in the way React itself records one (status and value); otherwise it suspends
      // for a moment even though the part is there. So the result is recorded here as soon as there is one.
      // The caller that draws handles a failure; a caller that only fetches ahead must not leave it unhandled.
      const p = pending;
      p.then(
        (value) => void Object.assign(p, { status: "fulfilled", value }),
        () => {},
      );
    }
    return pending;
  };
}

/** The same for a family of parts with a name each (the figures, the levels). */
export function onceEach<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const each = new Map<string, () => Promise<T>>();
  return (key) => {
    let get = each.get(key);
    if (!get) each.set(key, (get = once(() => load(key))));
    return get();
  };
}
