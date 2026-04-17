/**
 * Runtime configuration.
 *
 * VITE_API_URL is set at build time for production (GCS bucket).
 * In dev, Vite proxy handles it so the base is empty (relative paths).
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? '';
