/** Shared server action result shape for UI error handling. */
export type ActionResult = {
  success?: boolean;
  count?: number;
  error?: string;
};
