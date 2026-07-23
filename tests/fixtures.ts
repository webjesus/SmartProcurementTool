import type { BasisPosition, EvidenceReference, OfferLine } from "@/domain/contracts";

export const evidence: EvidenceReference = {
  id: "e-1",
  documentId: "doc-offer",
  pageNumber: 1,
  textItemIds: ["ti-1"],
  sourceText: "3 Stk 100,00 300,00",
  region: { x: 0.1, y: 0.2, width: 0.5, height: 0.05 },
  cropPath: null,
  status: "VERIFIED_NATIVE"
};

export const offerLine: OfferLine = {
  id: "offer-1",
  sourcePositionNumber: "2.3.10",
  supplierPositionNumber: "A-10",
  description: "Hocheffizienz Umwälzpumpe",
  manufacturer: "Synthetic",
  articleNumber: "SYN-001",
  quantity: 3,
  unit: "Stk",
  priceBasis: 1,
  currency: "EUR",
  moneyCandidates: [],
  interpretedUnitPrice: 100,
  interpretedTotalPrice: 300,
  role: "PRIMARY",
  groupId: "group-1",
  continuation: false,
  evidence: [evidence],
  verificationStatus: "NEEDS_REVIEW",
  lockedFields: []
};

export const basisPosition: BasisPosition = {
  id: "basis-1",
  documentId: "doc-basis",
  parentId: null,
  positionNumber: "2.3.10",
  description: "Hocheffizienz-Umwälzpumpe",
  quantity: 3,
  unit: "Stk",
  technicalAttributes: [],
  manufacturerRequirements: [],
  requiredScope: ["Pumpe"],
  notes: [],
  optional: false,
  alternative: false,
  heading: false,
  evidence: [
    {
      ...evidence,
      id: "e-basis",
      documentId: "doc-basis"
    }
  ]
};
