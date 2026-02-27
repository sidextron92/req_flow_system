// ============================================================
// Extraction Validation
// Checks whether the AI JSON has all required fields for a
// given requirement type. Returns a list of missing field names.
// ============================================================

export interface ValidationResult {
  valid: boolean;
  missingFields: string[];    // human-readable names shown in chat prompt
  missingKeys: string[];      // machine keys used for targeted re-fill
}

/**
 * Required fields per requirement type.
 * key   = machine key in the extracted JSON
 * label = what to ask the user for
 */
const REQUIRED_BY_TYPE: Record<
  string,
  { key: string; label: string; check: (v: unknown) => boolean }[]
> = {
  RESTOCK: [
    { key: "label_name",    label: "Brand / label name",  check: nonEmpty },
    { key: "category_name", label: "Product category",    check: nonEmpty },
    { key: "expiry_date",   label: "Delivery deadline",   check: nonEmpty },
    { key: "products",      label: "At least one product with a valid name (Brand Name + Numeric Code, e.g. ASIAN 010)", check: hasProducts },
  ],
  NEW_LABEL: [
    { key: "label_name",    label: "Brand / label name",              check: nonEmpty },
    { key: "category_name", label: "Product category",                check: nonEmpty },
    { key: "expiry_date",   label: "Delivery deadline",               check: nonEmpty },
    { key: "qty_required",  label: "Quantity required (e.g. 50 pairs)", check: nonEmpty },
  ],
  NEW_VARIETY: [
    { key: "expiry_date",   label: "Delivery deadline",               check: nonEmpty },
    { key: "qty_required",  label: "Quantity required (e.g. 30 units)", check: nonEmpty },
  ],
};

function nonEmpty(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

function hasProducts(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 &&
    (v as Record<string, unknown>[]).some(
      (p) => typeof p.product_name === "string" && p.product_name.trim() !== ""
    );
}

export function validateExtraction(
  extracted: Record<string, unknown>,
  requirementType: string
): ValidationResult {
  const rules = REQUIRED_BY_TYPE[requirementType] ?? REQUIRED_BY_TYPE.NEW_VARIETY;

  const missing = rules.filter((r) => !r.check(extracted[r.key]));

  return {
    valid: missing.length === 0,
    missingFields: missing.map((r) => r.label),
    missingKeys:   missing.map((r) => r.key),
  };
}
