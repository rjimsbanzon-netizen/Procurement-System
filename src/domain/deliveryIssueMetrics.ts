/** Match the server-backed discrepancy tracker's active (unresolved) records.
 * A corrected inspection does not automatically close its discrepancy record. */
export function countUnresolvedDiscrepancies(
  issues: ReadonlyArray<{ status?: string | null }>
): number {
  return issues.filter(issue => String(issue?.status ?? '').trim().toLowerCase() !== 'resolved').length;
}
