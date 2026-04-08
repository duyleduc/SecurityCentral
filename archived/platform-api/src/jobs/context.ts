/**
 * Shared job context interface.
 * All job data types should extend this to carry request_id for tracing.
 */
export interface JobContext {
  /** The request_id from the originating HTTP request (if any). */
  readonly request_id?: string;
}
