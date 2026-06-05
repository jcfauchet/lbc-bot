export interface ILensBudgetRepository {
  /** Count Lens calls recorded at or after `since`. */
  countSince(since: Date): Promise<number>
  recordCall(listingId: string | null, success: boolean): Promise<void>
}
