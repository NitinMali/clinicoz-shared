export interface PdfHeader {
  logoUrl?: string;
  /** Inline CSS applied to the logo img element (e.g. "width:120px; border-radius:4px") */
  logoStyle?: string;
  title?: string;
  description?: string;
  /** Full-width header image — when provided, replaces logo+title+description entirely */
  imageUrl?: string;
  /** Show header on all pages (true) or first page only (false, default) */
  showOnAllPages?: boolean;
}

export interface ParagraphItem {
  type: 'paragraph';
  text: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Inline CSS applied to the paragraph element */
  style?: string;
}

/** A bullet list item can be a plain string or a rich object with text + style */
export type BulletListEntry = string | { text: string; style?: string };

/** A table cell can be a plain string or a rich object with text + style */
export type TableCell = string | { text: string; style?: string };

/** A table header can be a plain string or a rich object with text + style */
export type TableHeader = string | { text: string; style?: string };

export interface TableItem {
  type: 'table';
  headers: TableHeader[];
  rows: TableCell[][];
  /** Inline CSS applied to the table element */
  style?: string;
}

export interface BulletListItem {
  type: 'bulletList';
  items: BulletListEntry[];
  /** Inline CSS applied to the ul element */
  style?: string;
}

export interface GridColumn {
  /** Optional width as a CSS value e.g. "40%", "1fr". Defaults to equal share. */
  width?: string;
  /** Text alignment for all content in this column */
  align?: 'left' | 'center' | 'right';
  /** Any mix of content items */
  content: (ParagraphItem | TableItem | BulletListItem | ImageItem)[];
}

export interface GridItem {
  type: 'grid';
  /** Number of columns — inferred from columns.length if omitted */
  columns: GridColumn[];
  /** Gap between columns, CSS value e.g. "16px". Default "12px". */
  gap?: string;
  /** Inline CSS applied to the grid container */
  style?: string;
}

export interface ImageItem {
  type: 'image';
  /** Image source — local path, https:// URL, or data:image/... blob */
  src: string;
  /** Optional width, CSS value e.g. "200px", "50%", "100%". Default "auto" */
  width?: string;
  /** Optional height, CSS value. Default "auto" */
  height?: string;
  /** Alignment. Default "left" */
  align?: 'left' | 'center' | 'right';
  /** Inline CSS applied to the img element */
  style?: string;
}

export type ContentItem = ParagraphItem | TableItem | BulletListItem | GridItem | ImageItem;

export interface PdfSection {
  title: string;
  content: ContentItem[]; // min length 1
  /** Inline CSS applied to the section wrapper */
  style?: string;
}

export interface PdfFooter {
  text: string;
}

export interface PdfDocument {
  header?: PdfHeader;
  body: PdfSection[]; // required, min length 1
  footer?: PdfFooter;
  /** Optional layout spacing config */
  layout?: PdfLayout;
}

/** Customise spacing between header, body, and footer */
export interface PdfLayout {
  /** Top margin / header area height, e.g. "10%", "25mm". Default "20mm" */
  headerHeight?: string;
  /** Bottom margin / footer area height, e.g. "8%", "18mm". Default "18mm" */
  footerHeight?: string;
  /** Extra padding above body content, e.g. "2%", "10mm". Default "0" */
  bodyPaddingTop?: string;
  /** Extra padding below body content, e.g. "2%", "10mm". Default "0" */
  bodyPaddingBottom?: string;
  /** Left margin, e.g. "5%", "15mm". Default "15mm" */
  marginLeft?: string;
  /** Right margin, e.g. "5%", "15mm". Default "15mm" */
  marginRight?: string;
}

export interface GenerationResult {
  buffer: Buffer;
  filename: string;
  filePath: string;
}

/** New flexible API — template name + arbitrary data + optional S3 output */
export interface PdfGenerateRequest {
  /** Template name (without extension), e.g. "invoice", "report", "document" */
  template: string;
  /** Arbitrary JSON data passed to the Handlebars template */
  data: Record<string, any>;
  /** Optional output config — if omitted, returns blob */
  output?: PdfOutputConfig;
}

export interface PdfOutputConfig {
  /** S3 bucket name. If blank/missing, PDF is returned as blob. */
  s3Bucket?: string;
  /** S3 folder/prefix, e.g. "reports/2024". No trailing slash. */
  s3Folder?: string;
}

export interface PdfGenerateResponse {
  /** The generated filename */
  filename: string;
  /** Present when output is blob (no S3 config) — base64-encoded PDF */
  blob?: string;
  /** Present when uploaded to S3 — the full S3 URL */
  s3Url?: string;
}
