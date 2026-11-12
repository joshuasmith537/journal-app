/** A Google Doc body, with the indexes the Docs API actually uses. */

export interface DocParagraph {
  startIndex: number;
  endIndex: number;
  /** Paragraph contents without the trailing newline. Inline objects are U+FFFC. */
  text: string;
  /** Text runs only, for reading entries. */
  plain: string;
}

export interface JournalDocument {
  revisionId: string;
  paragraphs: DocParagraph[];
  /** Exclusive end index of the body. The final newline is at endIndex - 1. */
  endIndex: number;
  /** Plain paragraph text, including the closing newline, for the entry parser. */
  text: string;
}

export class UnreadableDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableDocumentError";
  }
}

interface RawElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: { content?: string; textStyle?: unknown };
  inlineObjectElement?: unknown;
  horizontalRule?: unknown;
  pageBreak?: unknown;
  footnoteReference?: unknown;
  person?: unknown;
  richLink?: unknown;
}

interface RawBlock {
  startIndex?: number;
  endIndex?: number;
  paragraph?: { elements?: RawElement[] };
  table?: unknown;
  tableOfContents?: unknown;
  sectionBreak?: unknown;
}

const EMBEDDED = [
  "inlineObjectElement",
  "horizontalRule",
  "pageBreak",
  "footnoteReference",
  "person",
  "richLink",
] as const;

export function structureFromPlainText(text: string, revisionId = ""): JournalDocument {
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  const lines = normalized.slice(0, -1).split("\n");
  const paragraphs: DocParagraph[] = [];
  let startIndex = 1;
  for (const line of lines) {
    const endIndex = startIndex + line.length + 1;
    paragraphs.push({ startIndex, endIndex, text: line, plain: line });
    startIndex = endIndex;
  }
  return { revisionId, paragraphs, endIndex: startIndex, text: normalized };
}

export function readDocsBody(doc: { revisionId?: string; body?: { content?: RawBlock[] } }): JournalDocument {
  const content = doc.body?.content ?? [];
  if (content.length === 0) throw new UnreadableDocumentError("Document body is empty");
  const last = content[content.length - 1];
  if (last.endIndex === undefined) throw new UnreadableDocumentError("Document is missing indexes");
  if (!last.paragraph) throw new UnreadableDocumentError("Document does not end in a paragraph");
  const paragraphs = content.filter((block) => block.paragraph).map(measureParagraph);
  const text = `${paragraphs.map((paragraph) => paragraph.plain).join("\n")}\n`;
  return { revisionId: doc.revisionId ?? "", paragraphs, endIndex: last.endIndex, text };
}

export function assertConsistent(doc: JournalDocument): void {
  if (doc.paragraphs.length === 0) throw new UnreadableDocumentError("Document body is empty");
  const last = doc.paragraphs[doc.paragraphs.length - 1];
  if (last.endIndex !== doc.endIndex) throw new UnreadableDocumentError("Document end does not match its last paragraph");
  for (const paragraph of doc.paragraphs) {
    if (paragraph.endIndex - paragraph.startIndex !== paragraph.text.length + 1) {
      throw new UnreadableDocumentError("Paragraph indexes do not match its text");
    }
  }
}

export function isEmptyDocument(doc: JournalDocument): boolean {
  return doc.paragraphs.length === 1 && doc.paragraphs[0].text === "" && doc.endIndex <= 2;
}

function measureParagraph(block: RawBlock): DocParagraph {
  if (block.startIndex === undefined || block.endIndex === undefined || !block.paragraph) {
    throw new UnreadableDocumentError("Paragraph is missing indexes");
  }
  let text = "";
  let plain = "";
  for (const element of block.paragraph.elements ?? []) {
    if (element.textRun) {
      const content = element.textRun.content ?? "";
      text += content;
      plain += content;
      continue;
    }
    if (!EMBEDDED.some((key) => element[key] !== undefined)) {
      throw new UnreadableDocumentError("Document contains an element this app cannot update");
    }
    text += "\uFFFC";
  }
  if (!text.endsWith("\n")) throw new UnreadableDocumentError("Paragraph is missing its newline");
  if (block.endIndex - block.startIndex !== text.length) {
    throw new UnreadableDocumentError("Paragraph indexes do not match its text");
  }
  return {
    startIndex: block.startIndex,
    endIndex: block.endIndex,
    text: text.slice(0, -1),
    plain: plain.endsWith("\n") ? plain.slice(0, -1) : plain,
  };
}
