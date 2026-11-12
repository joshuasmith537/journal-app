import type { DocRequest, ParagraphStyle, TextStyle } from "../src/journal/batch";

/** Paragraph styles must stop before the segment's final newline. */
export function paragraphRangesStayInside(requests: DocRequest[], initial = "\n"): void {
  let text = initial;
  for (const request of requests) {
    if (request.insertText) {
      const at = request.insertText.location.index - 1;
      text = text.slice(0, at) + request.insertText.text + text.slice(at);
    } else if (request.deleteContentRange) {
      const start = request.deleteContentRange.range.startIndex - 1;
      const end = request.deleteContentRange.range.endIndex - 1;
      text = text.slice(0, start) + text.slice(end);
    } else if (request.updateParagraphStyle) {
      const segmentEnd = text.length + 1;
      if (request.updateParagraphStyle.range.endIndex >= segmentEnd) {
        throw new Error(`paragraph style includes the final newline (${request.updateParagraphStyle.range.endIndex} >= ${segmentEnd})`);
      }
    }
  }
}

export interface AppliedParagraph {
  text: string;
  textStyle?: TextStyle;
  para?: ParagraphStyle;
}

export function applyDoc(requests: DocRequest[], initial = "\n"): { text: string; paragraphs: AppliedParagraph[] } {
  let text = initial;
  let textStyles: Array<TextStyle | undefined> = new Array(text.length);
  let paraStyles: Array<ParagraphStyle | undefined> = new Array(text.length);

  const boundary = (index: number) => {
    if (index > 0 && index < text.length) {
      const current = text.charCodeAt(index);
      const previous = text.charCodeAt(index - 1);
      if (current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) {
        throw new Error(`split surrogate at ${index}`);
      }
    }
  };

  for (const request of requests) {
    if (request.insertText) {
      const at = request.insertText.location.index - 1;
      boundary(at);
      text = text.slice(0, at) + request.insertText.text + text.slice(at);
      const blank = new Array<undefined>(request.insertText.text.length);
      textStyles.splice(at, 0, ...blank);
      paraStyles.splice(at, 0, ...blank);
    } else if (request.deleteContentRange) {
      const start = request.deleteContentRange.range.startIndex - 1;
      const end = request.deleteContentRange.range.endIndex - 1;
      boundary(start);
      boundary(end);
      text = text.slice(0, start) + text.slice(end);
      textStyles.splice(start, end - start);
      paraStyles.splice(start, end - start);
    } else if (request.updateTextStyle) {
      const start = request.updateTextStyle.range.startIndex - 1;
      const end = request.updateTextStyle.range.endIndex - 1;
      boundary(start);
      boundary(end);
      for (let index = start; index < end; index += 1) textStyles[index] = request.updateTextStyle.textStyle;
    } else if (request.updateParagraphStyle) {
      const start = request.updateParagraphStyle.range.startIndex - 1;
      const end = request.updateParagraphStyle.range.endIndex - 1;
      boundary(start);
      boundary(end);
      for (let index = start; index < end; index += 1) paraStyles[index] = request.updateParagraphStyle.paragraphStyle;
    }
  }

  const paragraphs: AppliedParagraph[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const newline = text.indexOf("\n", cursor);
    if (newline < 0) break;
    const slice = text.slice(cursor, newline);
    if (slice.length) {
      const first = JSON.stringify(textStyles[cursor]);
      for (let index = cursor; index < newline; index += 1) {
        if (JSON.stringify(textStyles[index]) !== first) throw new Error(`inconsistent text style in "${slice}"`);
      }
    }
    paragraphs.push({
      text: slice,
      textStyle: slice.length ? textStyles[cursor] : undefined,
      para: paraStyles[newline] ?? (slice.length ? paraStyles[cursor] : undefined),
    });
    cursor = newline + 1;
  }
  return { text, paragraphs };
}
