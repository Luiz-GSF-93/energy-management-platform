export type OfferTermRevision={revision:number;expired:boolean|null;events:{status:string;version:number}[]};
export function eligibleOfferTerms(revisions:OfferTermRevision[]):OfferTermRevision[]{
 return revisions.filter(r=>r.expired===false&&r.events.at(-1)?.status==='APPROVED_INTERNAL');
}
