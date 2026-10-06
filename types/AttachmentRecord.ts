type Attachment_Types = "Vendor Quotation" | "Contract" | "ATQ" | "Excel"


export type IField = {
  label: string;
  value: string;
};

export type IDoc = {
  blob: File;
  children: unknown[];
  ext: string;
  fields: IField[];
  fileName: string;
  hasOcr: boolean;
  index: number;
  inline: boolean;
  mimeType: string;
  note: string;
  ocrPending: boolean;
  pageCount: number;
  pagesIndex: number;
  previewHtml: string;
  previewKind: string;
  records: unknown[];
  resumable: boolean;
  signing: unknown;
  size: number;
  status: string;
  textBlock: string;
  truncated: boolean;
};

export type IPage = {
    label: string;
    lines: string[];
}

export type IAttachmentRecord = {
  field: IField[];
  // TODO: fill this unknown type
  quotationFiles: unknown[];
  quotationRef: string;
  sourceFile: string;
};


export type IAttachments = Record<
  Attachment_Types,
  {
    docs: IDoc[];
    error?: unknown;
    file: string;
    fileObj?: File;
    isAtqRecord: boolean;
    ocrError?: unknown;
    pages: IPage[];
    parsed: boolean;
    pendingDocs: unknown[];
    phase: string;
    previewHtml: string;
    raw: unknown;
    rawFields: IField[];
    records: IAttachmentRecord[];
    self: unknown;
    signing: unknown;
    text: string;
  }
>;