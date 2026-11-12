/**
 * Field names copied from the Docs API discovery document
 * (https://docs.googleapis.com/$discovery/rest?version=v1).
 * A string value is the nested schema. null is a scalar.
 * `fontFamily` belongs to WeightedFontFamily, not TextStyle.
 */
export const DOCS_FIELD_TYPES: Record<string, Record<string, string | null>> = {
  TextStyle: {
    strikethrough: null,
    bold: null,
    fontSize: "Dimension",
    weightedFontFamily: "WeightedFontFamily",
    baselineOffset: null,
    foregroundColor: "OptionalColor",
    link: "Link",
    italic: null,
    backgroundColor: "OptionalColor",
    smallCaps: null,
    underline: null,
  },
  Dimension: { magnitude: null, unit: null },
  WeightedFontFamily: { weight: null, fontFamily: null },
  OptionalColor: { color: "Color" },
  Color: { rgbColor: "RgbColor" },
  RgbColor: { blue: null, red: null, green: null },
  Link: {
    bookmarkId: null,
    heading: "HeadingLink",
    headingId: null,
    tabId: null,
    bookmark: "BookmarkLink",
    url: null,
  },
  HeadingLink: { tabId: null, id: null },
  BookmarkLink: { tabId: null, id: null },
  ParagraphStyle: {
    headingId: null,
    keepLinesTogether: null,
    pageBreakBefore: null,
    spaceAbove: "Dimension",
    tabStops: "TabStop",
    keepWithNext: null,
    alignment: null,
    spacingMode: null,
    indentStart: "Dimension",
    lineSpacing: null,
    borderRight: "ParagraphBorder",
    borderBetween: "ParagraphBorder",
    spaceBelow: "Dimension",
    avoidWidowAndOrphan: null,
    direction: null,
    borderLeft: "ParagraphBorder",
    indentEnd: "Dimension",
    shading: "Shading",
    borderTop: "ParagraphBorder",
    borderBottom: "ParagraphBorder",
    namedStyleType: null,
    indentFirstLine: "Dimension",
  },
  TabStop: { alignment: null, offset: "Dimension" },
  ParagraphBorder: { color: "OptionalColor", padding: "Dimension", width: "Dimension", dashStyle: null },
  Shading: { backgroundColor: "OptionalColor" },
  NamedStyle: { textStyle: "TextStyle", paragraphStyle: "ParagraphStyle", namedStyleType: null },
  DocumentStyle: {
    background: "Background",
    documentFormat: "DocumentFormat",
    useCustomHeaderFooterMargins: null,
    evenPageFooterId: null,
    evenPageHeaderId: null,
    marginTop: "Dimension",
    defaultFooterId: null,
    marginLeft: "Dimension",
    useEvenPageHeaderFooter: null,
    flipPageOrientation: null,
    firstPageHeaderId: null,
    firstPageFooterId: null,
    marginFooter: "Dimension",
    pageNumberStart: null,
    marginBottom: "Dimension",
    pageSize: "Size",
    useFirstPageHeaderFooter: null,
    marginRight: "Dimension",
    defaultHeaderId: null,
    marginHeader: "Dimension",
  },
  Background: { color: "OptionalColor" },
  DocumentFormat: { documentMode: null },
  Size: { width: "Dimension", height: "Dimension" },
};

const FIELD_ROOTS: Record<string, string> = {
  updateTextStyle: "TextStyle",
  updateParagraphStyle: "ParagraphStyle",
  updateNamedStyle: "NamedStyle",
  updateDocumentStyle: "DocumentStyle",
};

/** Paths in a FieldMask that are not in the discovery schema. `*` is the whole mask. */
export function invalidFieldPaths(requestKind: string, fields: string): string[] {
  if (fields === "*") return [];
  const root = FIELD_ROOTS[requestKind];
  if (!root) return [fields];
  const bad: string[] = [];
  for (const raw of fields.split(",")) {
    const path = raw.trim();
    let schema: string | null = root;
    const parts = path.split(".");
    let ok = path.length > 0;
    for (let i = 0; ok && schema && i < parts.length; i += 1) {
      const table: Record<string, string | null> | undefined = DOCS_FIELD_TYPES[schema];
      const next: string | null | undefined = table?.[parts[i]];
      if (!table || next === undefined) ok = false;
      else if (next === null && i < parts.length - 1) ok = false;
      else schema = next;
    }
    if (!ok) bad.push(path);
  }
  return bad;
}
