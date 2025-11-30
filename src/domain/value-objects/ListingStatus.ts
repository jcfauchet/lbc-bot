export enum ListingStatus {
  NEW = 'new',
  ANALYZING = 'analyzing',
  ANALYZED = 'analyzed',
  NOTIFIED = 'notified',
  ARCHIVED = 'archived',
  IGNORED = 'ignored',
}

export function isValidListingStatus(status: string): status is ListingStatus {
  return Object.values(ListingStatus).includes(status as ListingStatus)
}

