import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const LOCAL_STORAGE_KEY = 'sc_project_scope';
const QUERY_PARAM = 'project';

/**
 * Project scope stored in the URL as `?project=<id>`.
 *
 * - `projectId === null` means "All projects" (no scope).
 * - Selection persists in localStorage so the next login opens with the same scope by default.
 * - Other query params are preserved across scope changes.
 */
export function useProjectScope() {
  const [searchParams, setSearchParams] = useSearchParams();

  const projectId = searchParams.get(QUERY_PARAM) || null;

  const setProject = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(QUERY_PARAM, id);
          else next.delete(QUERY_PARAM);
          return next;
        },
        { replace: false },
      );

      if (id) localStorage.setItem(LOCAL_STORAGE_KEY, id);
      else localStorage.removeItem(LOCAL_STORAGE_KEY);
    },
    [setSearchParams],
  );

  return { projectId, setProject };
}

/** Read the last-used scope from localStorage — for app bootstrap defaults. */
export function getStoredProjectScope(): string | null {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}
