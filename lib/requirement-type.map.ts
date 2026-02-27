// ============================================================
// Requirement Type Mapper
// Maps between UI display values and DB enum values
// ============================================================

// UI label → DB enum
export const REQUIREMENT_TYPE_TO_DB: Record<string, string> = {
  "Restock":     "RESTOCK",
  "New Label":   "NEW_LABEL",
  "New Variety": "NEW_VARIETY",
};

// DB enum → UI label
export const REQUIREMENT_TYPE_TO_UI: Record<string, string> = {
  "RESTOCK":     "Restock",
  "NEW_LABEL":   "New Label",
  "NEW_VARIETY": "New Variety",
};

export function toDBType(uiType: string): string {
  return REQUIREMENT_TYPE_TO_DB[uiType] ?? uiType;
}

export function toUIType(dbType: string): string {
  return REQUIREMENT_TYPE_TO_UI[dbType] ?? dbType;
}
