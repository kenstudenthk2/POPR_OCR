/*
 * Docparse engine — local, offline document parsing shared by Docparse/index.html
 * and PR Assistant App.html. Extracted from Docparse/index.html (PDF/OCR/Excel
 * pipeline + field-detection heuristic), stripped of all DOM manipulation so it
 * can be called from anywhere. Requires pdf.min.js, xlsx.full.min.js,
 * paddle-ocr.min.js, msgreader.min.js, and postal-mime.min.js to be loaded
 * first (same load order as Docparse/index.html).
 *
 * Public API:
 *   DocparseEngine.parseFile(file, onStatus) -> Promise<{ plainText, fields, hadOcr, pages }>
 *   DocparseEngine.extractFieldsFromBlocks(blocks)
 */
(function (global) {
  'use strict';

  // ---------- Field-detection heuristic (works on an array of paragraph
  // blocks, where each block is itself an array of lines separated from
  // neighboring blocks by a visible gap — a blank line, or a big vertical
  // jump on a PDF page). ----------
  // Matches "Label: value" and "標籤：value" — half- or full-width colon.
  // The space after the colon is optional because OCR output often drops it.
  // A leading "(" is a label character too: forms bracket a qualifier in front
  // of the name itself ("(Min)Contract Start Date:"). isLabelish has always
  // allowed it; leaving it out here silently dropped those pairs.
  const INLINE_RE = /^([(A-Za-z0-9一-鿿][A-Za-z0-9一-鿿 /.,()'&#-]{0,40}?)[:：]\s*(.+)$/;

  // How many words a label may run to. Six is right when the only evidence
  // that something IS a label is that it looks like one — beyond that a
  // sentence starts passing. An explicit colon is far stronger evidence, so a
  // punctuated label is allowed to be longer: "Total Direct Variable Cost with
  // HKT (HKD):" is seven words and unmistakably a label.
  const LABEL_MAX_WORDS = 6;
  const LABEL_MAX_WORDS_PUNCTUATED = 9;

  function isLabelish(t, maxWords) {
    if (!t || t.length > 45) return false;
    if (/^[\d.,%$()\s-]+$/.test(t)) return false;            // purely numeric/currency
    if (/^https?/i.test(t)) return false;
    if (!/^[(A-Za-z0-9一-鿿]/.test(t)) return false;
    return t.split(/\s+/).length <= (maxWords || LABEL_MAX_WORDS);
  }

  function isLabelOnly(line) {
    if (!line || line.length > 45) return false;
    if (/[.,;]$/.test(line)) return false;                    // sentence fragment, not a label
    if (/^https?:/.test(line)) return false;
    const bare = line.replace(/[:：]\s*$/, '');
    if (/[:：]/.test(bare)) return false;                 // inner colon -> it's a pair, not a bare label
    return isLabelish(bare);
  }

  // INLINE_RE with a guard: "https://..." must not parse as label "https".
  function matchInline(line) {
    const m = line.match(INLINE_RE);
    if (!m) return null;
    if (m[2].startsWith('//')) return null;
    return m;
  }

  // Parse ALL "label: value" pairs on one line. PDF cell boundaries survive
  // as runs of 2+ spaces, so "To   :   PCCW Ltd.   Date   :   17-Jun-2026"
  // yields TWO pairs instead of the second leaking into the first's value.
  // Returns { pairs, danglingLabel } — danglingLabel is a trailing "Label:"
  // with no value on the same line (its value continues on later lines).
  function parseLinePairs(text) {
    const tokens = text.split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
    const pairs = [];
    let curLabel = null;
    let curVal = [];
    let danglingLabel = null;

    const flush = () => {
      if (curLabel !== null) {
        const v = curVal.join(' ').trim();
        if (v) pairs.push({ label: curLabel, value: v });
        else danglingLabel = curLabel;
      }
      curLabel = null;
      curVal = [];
    };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const next = tokens[i + 1];

      if ((next === ':' || next === '：') && isLabelish(t, LABEL_MAX_WORDS_PUNCTUATED)) {
        flush();
        curLabel = t;
        i++; // consume the colon token
        continue;
      }
      // value cell with the colon fused to its front: ["To", ": PCCW Ltd."]
      const fusedNext = next && next.match(/^[:：]\s*(\S.*)$/);
      if (fusedNext && isLabelish(t, LABEL_MAX_WORDS_PUNCTUATED)) {
        flush();
        curLabel = t;
        curVal = [fusedNext[1].trim()];
        i++;
        continue;
      }
      const trailing = t.match(/^(.+?)[:：]$/);
      if (trailing && isLabelish(trailing[1], LABEL_MAX_WORDS_PUNCTUATED)) {
        flush();
        curLabel = trailing[1].trim();
        continue;
      }
      const inline = matchInline(t);
      if (inline && isLabelish(inline[1], LABEL_MAX_WORDS_PUNCTUATED)) {
        flush();
        curLabel = inline[1].trim();
        curVal = [inline[2].trim()];
        continue;
      }
      if (t === ':' || t === '：') continue;              // stray colon
      if (curLabel !== null) curVal.push(t);
      // tokens before any label are dropped from pairing (still in full text)
    }
    flush();
    if (!pairs.length && !danglingLabel) {
      const colonless = pairColonlessRow(tokens);
      if (colonless) return colonless;
    }
    return { pairs, danglingLabel };
  }

  // A form row that separates label from value by column position alone —
  // "Project Description   Maintenance Service for Huawei Switch Equipment" —
  // carries no colon to key off, and its shape is indistinguishable from a
  // two-column heading ("Proposed New Contract   Previous Contract"). Nothing
  // in the layout tells the two apart, so this only fires when the left cell
  // is a label the vocabulary already knows: recognition supplies the evidence
  // the punctuation does not.
  function pairColonlessRow(tokens) {
    if (tokens.length < 2 || tokens.length > 3) return null;
    const label = tokens[0];
    if (!isLabelish(label, LABEL_MAX_WORDS_PUNCTUATED) || !isKnownLabel(label)) return null;
    // A third cell is the next column's own (empty) label — "Agreement Number
    // TBC   Previous Agreement Number". It is dropped rather than emitted as a
    // dangling label, which would swallow the following lines as its value.
    if (tokens.length === 3 && !isLabelish(tokens[2])) return null;
    const value = tokens[1].trim();
    if (!value) return null;
    return { pairs: [{ label, value }], danglingLabel: null };
  }

  // ---------- ATQ ("Authority to Quote") form rescue pass ----------
  // This template's 3/4-column form rows (Customer Name / AGN Number side by
  // side, wrapped "Agreement Number" label, contract-summary tables reusing
  // headers like "Contract Revenue") defeat the generic column heuristic
  // above. Rather than widen that heuristic (risking regressions on other
  // document layouts), pull these known fields straight out of the full
  // text with targeted patterns, only when the text looks like this form.
  const ATQ_SUPERSEDED_LABELS = new Set(['authority to quote', 'agreement', 'contract', 'prod_type']);

  function extractAtqKeyFields(plainText) {
    if (!/authority to quote/i.test(plainText) && !/ATQ Ref\.?\s*No/i.test(plainText)) return [];

    const out = [];
    const grab = (label, re) => {
      const m = plainText.match(re);
      if (m && m[1]) out.push({ label, value: m[1].trim().replace(/\s{2,}/g, ' ') });
    };

    grab('ATQ Ref. No.', /ATQ Ref\.?\s*No\.?\s*(ATQ-[A-Za-z0-9-]+)/i);
    grab('Customer Name', /Customer Name\s+([A-Z][A-Za-z0-9 &.,'/()-]*?)(?=\s{2,}|\n|$)/);
    grab('AGN Number', /AGN Number\s+([A-Za-z0-9-]+)/i);
    grab('Vendor', /\bVendor\s+([A-Z][A-Za-z0-9 &.,'()-]*?)(?=\s{2,}|\n|$)/);
    grab('Agreement Number', /Agreement\s+([A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+)/i);
    grab('Total Contract Revenue', /Contract Revenue\s+(\$[\d,]+\.\d{2})/i);

    return out;
  }

  // Merge the ATQ rescue fields in front of the generically-detected fields,
  // dropping generic entries that duplicate or mangle the same information.
  function mergeAtqFields(fields, plainText) {
    const atqFields = extractAtqKeyFields(plainText);
    if (!atqFields.length) return fields;
    const atqLabels = new Set(atqFields.map(f => f.label.toLowerCase()));
    const rest = fields.filter(f => {
      const key = f.label.toLowerCase();
      return !atqLabels.has(key) && !ATQ_SUPERSEDED_LABELS.has(key);
    });
    return atqFields.concat(rest);
  }

  function extractFieldsFromBlocks(blocks) {
    const fields = [];
    for (const block of blocks) {
      const lines = block.filter(l => l.trim() !== '');
      if (!lines.length) continue;

      const parsed = lines.map(l => parseLinePairs(l));
      const pairLineCount = parsed.filter(p => p.pairs.length).length;

      // LIST MODE: several lines carry their own pairs — emit each line's
      // pairs; a line with no pairs that isn't itself a label continues the
      // previous field's value (wrapped addresses etc.).
      if (pairLineCount >= 2 && pairLineCount >= Math.ceil(lines.length * 0.4)) {
        let last = null;
        for (let i = 0; i < lines.length; i++) {
          if (parsed[i].pairs.length) {
            for (const p of parsed[i].pairs) {
              fields.push({ label: p.label, value: p.value });
            }
            last = fields[fields.length - 1];
            if (parsed[i].danglingLabel) {
              fields.push({ label: parsed[i].danglingLabel, value: '' });
              last = fields[fields.length - 1];
            }
          } else if (last && !isLabelOnly(lines[i])) {
            last.value = (last.value + ' ' + lines[i]).trim();
          } else {
            last = null; // bare label / section title breaks continuation
          }
        }
        continue;
      }

      // SEQUENTIAL MODE: inline pairs captured directly; one label-only line
      // may absorb the rest of the block as its wrapped value — but NOT when
      // the "value" is really a column of other labels (stacked layouts).
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const p = parsed[i];
        if (p.pairs.length) {
          for (const pr of p.pairs) fields.push(pr);
          if (p.danglingLabel && i + 1 < lines.length) {
            const rest = lines.slice(i + 1);
            fields.push({ label: p.danglingLabel, value: rest.join(' ').trim() });
            i = lines.length;
            continue;
          }
          i++;
          continue;
        }
        const label = p.danglingLabel || (isLabelOnly(line) ? line.replace(/[:：]\s*$/, '').trim() : null);
        if (label && i + 1 < lines.length) {
          let rest = lines.slice(i + 1);
          // a wrapped value never contains its own "label: value" pairs —
          // cut the absorption at the first line that does
          const cut = rest.findIndex(l => parseLinePairs(l).pairs.length > 0);
          if (cut >= 0) rest = rest.slice(0, cut);
          const labelishRest = rest.filter(l => isLabelOnly(l) && l.trim().split(/\s+/).length <= 2).length;
          // Two stacked labels are already a column ("Approver-5" over
          // "Approver-6", "Approver-7"), not a label and its wrapped value.
          const looksLikeLabelColumn = rest.length >= 2 && labelishRest / rest.length >= 0.6;
          if (rest.length && !looksLikeLabelColumn) {
            fields.push({ label, value: rest.join(' ').trim() });
            i = i + 1 + rest.length;
            continue;
          }
        }
        i++;
      }
    }

    return dedupeFields(fields);
  }

  // Drop junk and de-duplicate. Labels repeat across pages (headers on
  // every page) — keep the first occurrence, which comes from the page
  // where the layout parsed cleanly.
  function dedupeFields(fields) {
    const seenLabel = new Set();
    return fields.filter(f => {
      if (!f.value) return false;
      if (/^[:：]/.test(f.value)) return false;           // leaked colon -> mispaired
      if (/^page\s?\d+$/i.test(f.label)) return false;        // page footers
      if (/^[\d.,%$()\s-]+$/.test(f.label)) return false;     // numeric "labels"
      const key = f.label.toLowerCase();
      if (seenLabel.has(key)) return false;
      seenLabel.add(key);
      return true;
    });
  }

  // ---------- Fields from table blocks ----------
  //
  // Layout analysis turns most of a form into tables, and those tables used to
  // reach the reader — which renders them — but not the field extractor, which
  // only ever saw paragraphs. On a document built almost entirely out of grids
  // that threw most of it away: on the ATQ form, the customer number, every
  // contract figure and both cost totals were sitting in tables nobody read.
  //
  // Only three grid shapes carry label/value information. Everything else is
  // data — a list of uploaded files, a list of approvals — and is deliberately
  // left alone: flattening a data table into fields is what produces junk like
  // "Dim cost for = support further spare pool".

  // "$715,657.72", "(1,234.00)", "35.12%" — a cell holding a figure rather
  // than a name. Trailing-amount split needs the anchored form too.
  const AMOUNT_RE = /[($]\s?-?[\d,]+\.\d{2}\)?$/;
  const PERCENT_RE = /^-?[\d,]+(\.\d+)?\s?%$/;
  // The longest a filled-in form field runs to — the same length isLabelish
  // allows a label, for the same reason: a form's boxes are small.
  const COMPACT_VALUE_MAX = 45;
  const PAIR_GRID_MAX_ROWS = 6;

  function tableCell(row, i) {
    return String((row && row[i]) || '').trim();
  }

  function nonEmpty(cells) {
    return cells.filter(c => c !== '');
  }

  // A row with a single non-empty cell is the table's own caption
  // ("A.Summary by Contract Type"), not one of its rows.
  function dataRows(rows) {
    return rows.filter(r => nonEmpty(r.map(c => String(c || '').trim())).length >= 2);
  }

  function columnCells(rows, i) {
    return nonEmpty(rows.map(r => tableCell(r, i)));
  }

  function mostlyLabelish(cells, ratio) {
    if (!cells.length) return false;
    return cells.filter(c => isLabelish(c)).length / cells.length >= ratio;
  }

  // SHAPE 0 — a row that states its own separator:
  //   Service Period |  | : | 1 May 2026 to 30 Apr 2027 (Both dates inclusive)
  //   Contract Sum   |  | : | HK$6,137,434.00
  // A scanned letter of award lays its terms out as a two-column form, and the
  // column pass keeps the colon as a column of its own. That defeats every
  // shape below it: the colon column is not labelish, so the pair grid rejects
  // the table, and the values are prose, so the compactness guard rejects it
  // too — measured on a real award letter whose Contract Sum, Service Period
  // and Payment Terms were the only things on the page worth reading, and none
  // of which reached the fields at all.
  //
  // The colon is why this shape needs no heuristic. Everything else here infers
  // that something is a label from how it looks; a row with a colon cell in it
  // has SAID so, which is the same reasoning LABEL_MAX_WORDS_PUNCTUATED rests
  // on — so the value is allowed to be as long as it likes.
  // A row may hold more than one pair, the same way a text line can, so the
  // cell before each colon is that colon's label and everything after it is a
  // value until the next label — "Re | : | Fax | : | +852 2962 5076" is one
  // pair, not a Re whose value is somebody's fax number.
  function colonRowFields(rows) {
    const fields = [];
    rows.forEach(row => {
      const cells = row.map(c => String(c || '').trim()).filter(Boolean);
      // A cell that OPENS with the colon is the entry ticket, and it is the
      // whole reason this shape may skip the guards below. The colon is a cell
      // of its own ("Service Period | | : | 1 May 2026…") or fused to the front
      // of its value ("Re | : | Fax | : +852 2962 5076") — parseLinePairs
      // reads both forms on a text line for the same reason.
      //
      // A row without one is an ordinary table row. Requiring the colon at the
      // START is what keeps a purchase order's "Switch at least 46 port …
      // (Model: CE6863-48S6CQ)" out: it states a colon, but not as a separator,
      // and reading it as one swallows the whole line item as a value.
      if (!cells.some(c => /^[:：]/.test(c))) return;
      let label = null;
      let value = [];
      const flush = () => {
        if (label && value.length) fields.push({ label, value: value.join(' ') });
        label = null;
        value = [];
      };
      // Each separator closes the pair before it and opens the next one, whose
      // label is the cell immediately to its left — the same walk
      // parseLinePairs does over a line's tokens, so a row may hold more than
      // one pair. Without that, "Re | : | Fax | : +852 2962 5076" reads as a
      // subject line whose value is somebody's fax number.
      for (const cell of cells) {
        const sep = cell.match(/^[:：]\s*(.*)$/);
        if (!sep) { value.push(cell); continue; }
        const own = value.pop();                            // the cell to its left
        if (own === undefined) continue;                    // a colon opening the row
        flush();
        if (isLabelish(own, LABEL_MAX_WORDS_PUNCTUATED)) label = own;
        value = sep[1] ? [sep[1].trim()] : [];
      }
      flush();
    });
    return fields.length ? fields : null;
  }

  // SHAPE 1 — a form grid whose columns alternate label, value, label, value:
  //   Customer Number | 82332954 | Customer Name | HOSPITAL AUTHORITY
  // Only 2 and 4 columns qualify. Wider grids of this kind do not occur, and
  // allowing them would start matching data tables that happen to open with a
  // descriptive column.
  function pairGridFields(rows) {
    const width = Math.max(...rows.map(r => r.length));
    if (width !== 2 && width !== 4) return null;
    // A form names every row; a data table names its columns once and then
    // lists records under them. Both look alike cell by cell, and the honest
    // difference between them is length — a form's identity block is a few
    // rows, a list of uploaded files is not.
    if (rows.length > PAIR_GRID_MAX_ROWS) return null;
    for (let c = 0; c < width; c += 2) {
      if (!mostlyLabelish(columnCells(rows, c), 0.8)) return null;
    }
    const fields = [];
    rows.forEach(row => {
      for (let c = 0; c < width; c += 2) {
        const label = tableCell(row, c);
        const value = tableCell(row, c + 1);
        if (label && value && isLabelish(label)) fields.push({ label, value });
      }
    });
    if (!fields.length) return null;
    // What a form holds is an answer, and an answer fits in its box. Two
    // columns of prose have the same shape — a purchase order's part number
    // beside its specification — and are not a form.
    const compact = fields.filter(f => f.value.length <= COMPACT_VALUE_MAX).length;
    return compact / fields.length >= 0.6 ? fields : null;
  }

  // SHAPE 2 — a figure table read down its first column:
  //   Contract Revenue | $715,657.72 | $0.00 | $715,657.72 | 100.00%
  // The value column must NOT itself be labelish, which is what separates a
  // data row from the header rows above it ("SERVICE | ACT | UCT").
  function firstColumnFields(rows) {
    const fields = [];
    rows.forEach(row => {
      let label = tableCell(row, 0);
      let value = tableCell(row, 1);
      // Column clustering sometimes fuses a row's figure onto the end of its
      // own label ("Contribution / Contribution% $215,573.56").
      if (!value) {
        const fused = label.match(AMOUNT_RE);
        if (!fused) return;
        value = fused[0].trim();
        label = label.slice(0, fused.index).trim();
      }
      if (!label || !isLabelish(label) || isLabelish(value)) return;
      const isFigure = AMOUNT_RE.test(value) || PERCENT_RE.test(value);
      // An amount immediately followed by its own percentage belongs with it:
      // "Gross Profit / GP%" is one field reading "$251,356.45 (35.12%)".
      const next = nonEmpty(row.slice(2).map(c => String(c || '').trim()))[0];
      if (next && PERCENT_RE.test(next) && AMOUNT_RE.test(value)) {
        value += ' (' + next + ')';
      }
      fields.push({ label, value, isFigure });
    });
    if (!fields.length) return null;
    // Only a table of FIGURES is read this way. A purchase order's line items
    // have the same shape — a description on the left, more text on the right
    // — and reading those as fields turns "Low-end Layer-2 Ethernet PoE
    // switch…" into the value of whatever happened to precede it.
    const figures = fields.filter(f => f.isFigure).length;
    if (figures / fields.length < 0.6) return null;
    return fields.map(f => ({ label: f.label, value: f.value }));
  }

  // SHAPE 3 — a header row over exactly one data row, i.e. a single record
  // written across instead of down:
  //   CONT_TYPE | CONTRACT | RATE | ... | EBITDA
  //   WB        | $715,657.72 | $59,638.14 | ... | 65.24%
  function transposedRecordFields(rows) {
    if (rows.length !== 2) return null;
    const [header, data] = rows;
    const width = Math.max(header.length, data.length);
    if (width < 3) return null;
    const labelish = nonEmpty(header.map(c => String(c || '').trim()))
      .filter(c => isLabelish(c) && c.split(/\s+/).length <= 3);
    if (labelish.length < 3) return null;
    const values = nonEmpty(data.map(c => String(c || '').trim())).filter(c => !isLabelish(c));
    if (values.length < 2) return null;
    const fields = [];
    for (let c = 0; c < width; c++) {
      const label = tableCell(header, c);
      const value = tableCell(data, c);
      if (label && value && isLabelish(label)) fields.push({ label, value });
    }
    return fields.length ? fields : null;
  }

  function fieldsFromTable(rows) {
    const body = dataRows(rows || []);
    if (body.length < 1) return [];
    return colonRowFields(body) ||
      pairGridFields(body) ||
      transposedRecordFields(body) ||
      firstColumnFields(body) ||
      [];
  }

  function extractFieldsFromTables(tables) {
    const fields = [];
    for (const rows of tables) fields.push(...fieldsFromTable(rows));
    return dedupeFields(fields);
  }

  // ---------- Label canonicalisation ----------
  //
  // The same document reaches us in several shapes — a PDF with a text layer, a
  // scan of that same PDF, and a workbook of the same form — and each spells its
  // labels differently. OCR in particular is consistently wrong in the same few
  // ways ("Equlpment Liat", "Malntenance Perlod", "Quotatton No", "MAINTENANCE
  // SERVICE AGREMENT"), which left the scanned copy of a document answering
  // under different field names than the clean copy attached to the same email.
  //
  // So every field, whatever produced it, is snapped onto a canonical spelling
  // before anyone sees it. Two mechanisms, cheapest first: an exact alias table
  // for known synonyms, then a fuzzy match that scores substitutions between
  // characters OCR actually confuses (i/l/t/1, s/a, c/o/e, n/m) far below a
  // genuine difference, so "Malntenance Perlod" lands on "Maintenance Period"
  // while "Maintenance Charges" — a different label — does not.
  const CANONICAL_LABELS = [
    // HKT / PCCW maintenance service agreement + quotation template
    '7x24 Professional Helpdesk Telephone', 'Email for IPT/PABX', 'E-mail for others',
    'Maintenance Service Agreement', 'Maintenance Period', 'Maintenance Contract Expiry Date',
    'Net Total Maintenance Service Fee (HKD)', 'Maintenance Service Fee',
    'Equipment List', 'Equipment Description', 'Service Plan', 'Agreement No', 'Quotation No',
    'Telephone No.', 'Sales Name', 'Installation Address', 'Customer Equipment',
    'Scope of Services Coverage', 'Prime No.', 'System No.', 'WO No.',
    // ATQ ("Authority to Quote") form
    'ATQ Ref. No.', 'Customer Name', 'Customer Number', 'AGN Number', 'AGN Name',
    'Project Description', 'Agreement Number', 'Existing Service Provider', 'Competitor(s)',
    'Customer Payment Term', 'Contract Type', 'Contract Month', 'Total Contract Revenue',
    'No. of WO', 'Justification/Payment Remarks', 'Justification/Payment', 'Approval History',
    // Bare "Quotation", "Remark" and "Item No." are deliberately absent. The
    // cost-table records label their own fields and never pass through here,
    // while adding those spellings pulled real labels off other documents —
    // "Remarks" started answering as "Remark", and a scanned quotation's
    // heading began claiming the fee table as its value.
    'Product Type', 'Service Type', 'Vendor / Distributor', 'Back-to-Back (Y/N)',
    'Total Value of Quotation (HKD)', 'Cash Flow Mismatch',
    'WB New Customer', 'Tender / RFQ (if applicable)', 'Closing Date (if applicable)',
    '(Min)Contract Start Date', '(Max)Contract End Date',
    // ATQ contract-summary and cost tables, read down their first column
    // "Gross Profit / GP%" is deliberately NOT here. The PDF prints profit and
    // its percentage as one label and the workbook keeps "Gross Profit" and
    // "Gross Profit%" apart; adding the combined spelling made both workbook
    // labels fuzzy-match onto it, and the percentage was lost to de-duplication.
    'Direct Variable Cost', 'Indirect Variable Cost', 'Monthly Revenue (ref. only)', 'EBITDA',
    'Total Direct Variable Cost with HKT (HKD)', 'Total Direct Variable Cost without HKT (HKD)',
    'Existing WO# (or Circuit No.)', 'Previous Agreement Number',
    // Vendor price quotations (Cisco and friends)
    'Quote ID', 'Quote Name', 'Quote Number', 'Quote Status', 'Quote Total', 'Quote Date',
    'Quote Net Amount', 'Quote Extended List Price', 'Quote Currency', 'Quote Created By',
    'Deal ID', 'Deal Expiration', 'Date Approved', 'Bill to ID', 'Bill to Name',
    'Price Protection Date', 'Price Protection Expiry Date', 'Price List', 'End Customer',
    'Expiry Date', 'Unit Price', 'Extended List Price', 'Total List Price',
    // Generic commercial-document labels
    'Purchase Order', 'Contract Number', 'Payment Terms', 'Salesperson', 'Attention',
    'Grand Total', 'Sub-Total', 'Net Total', 'Total Amount (HK$)', 'Our Ref', 'Job No.',
    'Contact No.', 'Validity', 'Remarks', 'Currency', 'Location', 'End user', 'Subject',
  ];

  // Exact synonyms, keyed by foldLabelKey(). These are different *names* for the
  // same thing rather than misreadings of one name, so no amount of fuzzy
  // matching would connect them.
  const LABEL_ALIASES = {
    'contractrevenue': 'Total Contract Revenue',
    'totalcontractrevenue': 'Total Contract Revenue',
    'creater': 'Creator',
    'creator': 'Creator',
    'attn': 'Attention',
    'email': 'Email',
    'emall': 'Email',
    'tel': 'Tel',
    'quotationnumber': 'Quotation No',
    'quoteno': 'Quote ID',
    'totalvalueofquotationhkd': 'Total Value of Quotation (HKD)',
    // The ATQ's summary tables abbreviate the same fields its form spells out.
    'conttype': 'Contract Type',
    'prodtype': 'Product Type',
    'contractmonth': 'Contract Month',
  };

  // Casing, spacing and punctuation all survive OCR badly ("EmallforIPT/PABX"
  // for "Email for IPT/PABX"), so they are removed before comparing. Only the
  // letters and digits carry the signal.
  function foldLabelKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  }

  // Characters PaddleOCR swaps for one another on this document set. Same
  // group -> a substitution between them barely counts as a difference.
  const OCR_CONFUSION_GROUPS = ['il1t', 'oc0e', 'as5', 'nmh', 'uv', 'gq9', 'b6', 'z2', 'fr'];
  const OCR_CONFUSION = (() => {
    const map = new Map();
    OCR_CONFUSION_GROUPS.forEach((group, gi) => {
      for (const ch of group) map.set(ch, gi);
    });
    return map;
  })();
  const CONFUSION_COST = 0.3;

  function substitutionCost(a, b) {
    if (a === b) return 0;
    const ga = OCR_CONFUSION.get(a);
    return (ga !== undefined && ga === OCR_CONFUSION.get(b)) ? CONFUSION_COST : 1;
  }

  function ocrDistance(a, b) {
    const prev = new Array(b.length + 1);
    const cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,                                        // deletion
          cur[j - 1] + 1,                                     // insertion
          prev[j - 1] + substitutionCost(a[i - 1], b[j - 1])  // substitution
        );
      }
      for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  // Short labels ("To", "Tel", "Date") are left alone: at that length almost
  // any other short label is within tolerance, so a fuzzy match would invent
  // matches instead of repairing them.
  const FUZZY_MIN_LEN = 6;
  const FUZZY_MAX_DISTANCE_RATIO = 0.25;
  // A repair is only trusted when the runner-up is clearly worse; otherwise the
  // label is ambiguous between two canonical names and the original is kept.
  const FUZZY_MIN_MARGIN = 0.5;

  function bestFuzzyMatch(key, candidates) {
    if (key.length < FUZZY_MIN_LEN) return null;
    let best = null, bestD = Infinity;
    const scored = [];
    for (const cand of candidates) {
      // Length alone rules most candidates out, and skipping them keeps this
      // linear scan cheap enough to run on every field of every document.
      if (Math.abs(cand.key.length - key.length) > Math.ceil(key.length * FUZZY_MAX_DISTANCE_RATIO)) continue;
      const d = ocrDistance(key, cand.key);
      scored.push({ d, label: cand.label });
      if (d < bestD) { bestD = d; best = cand; }
    }
    if (!best) return null;
    if (bestD > key.length * FUZZY_MAX_DISTANCE_RATIO) return null;
    // The runner-up is only a rival if it is a *different* label. The same
    // label reaching us twice — once from the built-in dictionary and once from
    // a sibling attachment that uses it — is agreement, not ambiguity, and
    // treating it as a tie is what would reject the clearest matches of all.
    let runnerUp = Infinity;
    for (const s of scored) {
      if (s.label !== best.label && s.d < runnerUp) runnerUp = s.d;
    }
    if (runnerUp - bestD < FUZZY_MIN_MARGIN) return null;
    return best.label;
  }

  const CANONICAL_INDEX = (() => {
    const byKey = new Map();
    const list = [];
    for (const label of CANONICAL_LABELS) {
      const key = foldLabelKey(label);
      if (byKey.has(key)) continue;
      byKey.set(key, label);
      list.push({ key, label });
    }
    return { byKey, list };
  })();

  // Cheap tidy-ups that apply before any matching: a trailing colon the layout
  // pass left behind, runs of whitespace, and the "_New" suffix the ATQ
  // workbook appends to the current-revision copy of every field.
  function tidyLabel(label) {
    return String(label || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[:：\s]+$/, '')
      .replace(/_New$/i, '')
      .trim();
  }

  // Is this *exactly* a label the vocabulary already knows? Deliberately exact
  // (after the same folding canonicalizeLabel uses) rather than fuzzy: this
  // gates heuristics that have no other evidence to work from, so a near-miss
  // must not open the gate — that is what canonicalizeLabel's fuzzy pass is
  // for, and it runs later, once something has already been called a field.
  function isKnownLabel(label) {
    const key = foldLabelKey(tidyLabel(label));
    if (!key) return false;
    return CANONICAL_INDEX.byKey.has(key) ||
      Object.prototype.hasOwnProperty.call(LABEL_ALIASES, key);
  }

  function canonicalizeLabel(label, extraCandidates) {
    const tidied = tidyLabel(label);
    if (!tidied) return tidied;
    const key = foldLabelKey(tidied);
    if (!key) return tidied;
    if (CANONICAL_INDEX.byKey.has(key)) return CANONICAL_INDEX.byKey.get(key);
    if (LABEL_ALIASES[key]) return LABEL_ALIASES[key];
    const candidates = extraCandidates && extraCandidates.length
      ? CANONICAL_INDEX.list.concat(extraCandidates)
      : CANONICAL_INDEX.list;
    return bestFuzzyMatch(key, candidates) || tidied;
  }

  // Whitespace and a leaked leading colon are the only value edits made here.
  // Everything else a value might need (a misread digit, a mangled email
  // domain) is guessing without evidence — that repair is done in
  // reconcileOcrFields(), where a clean copy of the same text is on hand.
  function canonicalizeValue(value) {
    return String(value == null ? '' : value)
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[:：]\s*/, '')
      .trim();
  }

  // Canonicalising merges labels that were previously distinct, so duplicates
  // have to be dropped again afterwards. The first occurrence wins, matching
  // extractFieldsFromBlocks: it comes from wherever the layout parsed cleanest.
  function canonicalizeFields(fields, extraCandidates) {
    const seen = new Set();
    const out = [];
    for (const f of fields || []) {
      const label = canonicalizeLabel(f.label, extraCandidates);
      const value = canonicalizeValue(f.value);
      if (!label || !value) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...f, label, value });
    }
    return out;
  }

  // ---------- Cross-attachment reconciliation ----------
  //
  // A PR request email almost always carries the same document twice: a clean
  // copy (a PDF with a text layer, or the workbook it was generated from) and a
  // signed scan of it. The scan is the one OCR mangles — and the clean copy is
  // sitting right there in the same email, saying what the words actually are.
  //
  // So before any fields are shown, the labels and word-level values recovered
  // by OCR are matched against the vocabulary of every attachment in the email
  // that did NOT need OCR (plus the attachment filenames, which are exact text
  // by definition). This is what makes a scanned attachment answer under the
  // same field names, with the same spellings, as its clean sibling.
  //
  // Values are repaired far more cautiously than labels. A label is a name and
  // getting it wrong costs a mismatched row; a value is data, and silently
  // "correcting" a quotation number or an amount into a different one is worse
  // than leaving the OCR error visible. Hence NO_DIGIT_REWRITE below.
  const VOCAB_MIN_TOKEN_LEN = 5;
  const VALUE_MAX_DISTANCE_RATIO = 0.2;

  function vocabularyTokens(text) {
    return String(text || '')
      .split(/\s+/)
      .map(t => t.replace(/^[^\w@(]+|[^\w@)]+$/g, ''))
      .filter(t => t.length >= VOCAB_MIN_TOKEN_LEN && /[A-Za-z]/.test(t));
  }

  // Labels and word tokens from every source in the email that OCR never
  // touched. `labels` feeds canonicalizeLabel as extra candidates; `tokens`
  // feeds repairValueToken.
  function buildCleanVocabulary(docs, extraText) {
    const labels = [];
    const labelKeys = new Set();
    const tokens = new Map();

    const addLabel = (label) => {
      const key = foldLabelKey(label);
      if (!key || key.length < FUZZY_MIN_LEN || labelKeys.has(key)) return;
      labelKeys.add(key);
      labels.push({ key, label });
    };
    const addTokens = (text) => {
      for (const t of vocabularyTokens(text)) {
        const key = foldLabelKey(t);
        if (key && !tokens.has(key)) tokens.set(key, t);
      }
    };

    for (const doc of docs || []) {
      // Filenames are exact text even when the document inside is a scan, so
      // they are harvested regardless of how the attachment parsed.
      addTokens(String(doc.fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      if (doc.hadOcr || doc.status !== 'parsed') continue;
      for (const f of doc.fields || []) {
        // Our own findings are not the document's words. Letting "Signature"
        // or "Not found" into the vocabulary would have them rewriting real
        // text in the scan next door.
        if (f.derived) continue;
        addLabel(f.label);
        addTokens(f.value);
      }
    }
    addTokens(extraText);

    return { labels, tokens };
  }

  // A digit that turns into a *different* digit is never a repair we are
  // willing to make: "H260590125JW" and "H260690125JW" are two different
  // quotation numbers, not one misread one, and nothing in the text can tell
  // us which the scan meant.
  function rewritesADigit(from, to) {
    const a = String(from).replace(/\D/g, '');
    const b = String(to).replace(/\D/g, '');
    return a !== b;
  }

  // Case is not something OCR gets wrong — it reads "MAINTENANCE" as
  // "MAlNTENANCE", never as "maintenance" — so the scan's own casing is the
  // authority and the vocabulary's is discarded. Without this, a value repaired
  // against a sibling came back re-cased to however that sibling happened to
  // write the word, turning "Maintenance for Cisco IPT System" into
  // "maintenance for Cisco IPT system".
  // Case is re-imposed only on plain words. An email address, a reference or a
  // part number carries case that belongs to the string itself rather than to
  // its position in a sentence — "Juno.BJ.Wu@pccw.com" is not a capitalised
  // "juno.bj.wu@pccw.com" — so for those the clean sibling's exact spelling is
  // the answer and re-casing it would be damage, not repair.
  function isPlainWord(s) {
    return /^[A-Za-z]+$/.test(s);
  }

  // Counted rather than compared against toUpperCase(): the misread character
  // that made this word need repairing is often itself a case slip — "MAlNTENANCE"
  // is an all-caps word with one stray lowercase l, and testing
  // `s === s.toUpperCase()` would call it mixed-case and title-case the repair.
  function matchCase(replacement, original) {
    if (!isPlainWord(original) || !isPlainWord(replacement)) return replacement;
    const upper = (original.match(/[A-Z]/g) || []).length;
    const lower = (original.match(/[a-z]/g) || []).length;
    if (!upper && !lower) return replacement;
    if (upper > lower) return replacement.toUpperCase();
    if (!upper) return replacement.toLowerCase();
    if (original[0] === original[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
    }
    return replacement.toLowerCase();
  }

  function repairValueToken(token, vocab) {
    const key = foldLabelKey(token);
    if (key.length < VOCAB_MIN_TOKEN_LEN) return token;
    const exact = vocab.tokens.get(key);
    // An exact key match means the letters already agree and only punctuation
    // or case differed — nothing to repair, and re-casing would be a loss.
    if (exact) return token;

    let best = null, bestD = Infinity, secondD = Infinity;
    for (const [candKey, candidate] of vocab.tokens) {
      if (Math.abs(candKey.length - key.length) > 2) continue;
      const d = ocrDistance(key, candKey);
      if (d < bestD) { secondD = bestD; bestD = d; best = candidate; }
      else if (d < secondD) { secondD = d; }
    }
    if (!best) return token;
    if (bestD > key.length * VALUE_MAX_DISTANCE_RATIO) return token;
    if (secondD - bestD < FUZZY_MIN_MARGIN) return token;
    if (rewritesADigit(token, best)) return token;
    return matchCase(best, token);
  }

  // Repairs a value word by word, keeping the original spacing and any
  // punctuation the tokenizer trimmed off the ends.
  function repairValue(value, vocab) {
    if (!vocab.tokens.size) return value;
    return String(value).replace(/[^\s]+/g, (word) => {
      const m = word.match(/^([^\w@(]*)(.*?)([^\w@)]*)$/);
      if (!m || !m[2]) return word;
      return m[1] + repairValueToken(m[2], vocab) + m[3];
    });
  }

  function reconcileOcrFields(fields, vocab) {
    // Fields we derived ourselves (what the ink inspection found) never went
    // through OCR, so there is nothing in them to repair and any "repair"
    // would only corrupt a finding we are sure of. They are set aside and
    // re-appended untouched.
    const derived = (fields || []).filter(f => f.derived);
    const reconciled = (fields || []).filter(f => !f.derived).map(f => ({
      ...f,
      label: canonicalizeLabel(f.label, vocab.labels),
      value: repairValue(canonicalizeValue(f.value), vocab),
    }));
    // canonicalizeFields again, for the de-duplication: two differently
    // misread spellings of one label can now both land on the same name.
    return canonicalizeFields(reconciled, vocab.labels).concat(derived);
  }

  // ---------- PaddleOCR (bundled locally; models fetched from CDN once) ----------
  // ppu-paddle-ocr wraps the official PaddlePaddle/PaddleOCR PP-OCRv6 models,
  // hosted as .ort files by the package's model CDN.
  const OCR_MODEL = typeof global.PpuPaddleOcr !== 'undefined' ? global.PpuPaddleOcr.V6_SMALL_MODEL : null;
  let _paddleOcr = null;

  async function getPaddleOcr(notify) {
    if (_paddleOcr) return _paddleOcr;
    notify('Downloading OCR models (~30 MB, first time only)…');
    _paddleOcr = new global.PpuPaddleOcr.PaddleOcrService({ model: OCR_MODEL });
    await _paddleOcr.initialize();
    return _paddleOcr;
  }

  async function dataUrlToArrayBuffer(dataUrl) {
    const resp = await fetch(dataUrl);
    return resp.arrayBuffer();
  }

  // Convert PaddleOCR results (text + bounding box per detected line) into
  // the same {text, cells, cellStarts, bigGapBefore} line structure the PDF
  // text path produces, so tables / side-by-side columns / field detection
  // all work identically on scanned content.
  function ocrResultsToLines(results) {
    const items = (results || [])
      .filter(r => r.text && r.text.trim())
      .map(r => ({
        text: r.text.trim(),
        x: r.box.x,
        yTop: r.box.y,
        yBottom: r.box.y + r.box.height,
      }));
    if (!items.length) return [];

    const heights = items.map(i => i.yBottom - i.yTop).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 20;

    items.sort((a, b) => (a.yTop + a.yBottom) / 2 - (b.yTop + b.yBottom) / 2);
    const rows = [];
    for (const it of items) {
      const yc = (it.yTop + it.yBottom) / 2;
      const row = rows.length ? rows[rows.length - 1] : null;
      if (row && Math.abs(yc - row.yc) <= medH * 0.6) {
        row.items.push(it);
        row.yc = (row.yc * (row.items.length - 1) + yc) / row.items.length;
      } else {
        rows.push({ yc, items: [it] });
      }
    }
    rows.forEach(r => r.items.sort((a, b) => a.x - b.x));

    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push(rows[i].yc - rows[i - 1].yc);
    gaps.sort((a, b) => a - b);
    const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : medH * 1.5;

    return rows.map((r, i) => ({
      text: r.items.map(it => it.text).join('   '),
      cells: r.items.map(it => it.text),
      cellStarts: r.items.map(it => it.x),
      bigGapBefore: i > 0 && (rows[i].yc - rows[i - 1].yc) > Math.max(medGap * 1.7, medGap + medH * 0.8),
    }));
  }

  // The size of the render the recognizer was handed. Only asked for when the
  // caller wants boxes, because it costs a decode of the PNG that was just
  // encoded; a failure here loses the context feature for that page and
  // nothing else, so it is swallowed rather than failing the read.
  async function imageSizeOf(dataUrl) {
    try {
      if (typeof createImageBitmap !== 'function') return null;
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const size = { width: bmp.width, height: bmp.height };
      if (typeof bmp.close === 'function') bmp.close();
      return size;
    } catch (e) {
      return null;
    }
  }

  // `wantBoxes` asks for the recognized lines' geometry alongside the text, as
  // fractions of the page — what attachMarkContext needs to tell which party a
  // chop on a SCANNED page belongs to. Off unless asked: it costs a decode.
  async function runOcrPass(dataUrl, notify, wantBoxes) {
    const ocr = await getPaddleOcr(notify);
    notify('Recognizing text…');
    const buf = await dataUrlToArrayBuffer(dataUrl);
    const { results, confidence } = await ocr.recognize(buf, { flatten: true });
    const items = (results || []).filter(r => r.text && r.text.trim());
    const chars = items.reduce((n, r) => n + r.text.trim().length, 0);
    // Confidence alone would rank a page that recognized three words very
    // surely above one that recognized four hundred well, so the amount read
    // has to count too — dampened, or a page of confidently-wrong noise wins on
    // volume. This score is only ever compared between rotations of the SAME
    // page, so its absolute value means nothing.
    const score = (confidence || 0) * Math.sqrt(chars);
    const pass = { blocks: buildBlocks(ocrResultsToLines(results)), score, confidence: confidence || 0, chars };
    if (wantBoxes) {
      const size = await imageSizeOf(dataUrl);
      if (size) {
        pass.boxes = boxesAsPageFractions(items.map(r => ({
          x: r.box.x, y: r.box.y, w: r.box.width, h: r.box.height, text: r.text.trim(),
        })), size.width, size.height);
      }
    }
    return pass;
  }

  // A scan is not always the right way up. A page fed to us sideways or upside
  // down still produces detections — the recognizer reads the boxes it finds
  // and returns confident-looking nonsense — so the giveaway is a low
  // confidence, not an empty result. When the upright pass looks weak, the
  // other three rotations are tried and the best-scoring one wins.
  //
  // 180° is tried before the sideways ones because it is both the commoner
  // mistake (a page fed in reversed) and the cheaper one to rule out.
  const OCR_ROTATION_RETRY_ORDER = [180, 90, 270];
  // Below this, the upright pass is not trusted enough to skip the retries.
  // Above it, a correctly-oriented page is being read well and three more OCR
  // passes would be pure cost.
  const OCR_GOOD_CONFIDENCE = 0.7;

  // Orientation is a property of the scan, not of each page in it: a document
  // fed into the scanner sideways is sideways on every page. So the probe runs
  // once, on the first page that needs it, and the winning rotation is then
  // applied directly to the rest — 3 extra passes per document instead of 3 per
  // page. That distinction is the difference between a 20-page signed agreement
  // finishing and it timing out with nothing to show.
  //
  // The probe reads a deliberately small render. Deciding which way up a page
  // is does not need the resolution that reading its small print does — the
  // four passes only have to be comparable to each other — and at full size
  // this cost four full-resolution recognitions of page 1 before a single page
  // had been banked, which on a five-page A4 scan ran the whole attachment out
  // of time. Small enough to be cheap, large enough that lines still resolve.
  const OCR_PROBE_LONG_EDGE = 1000;

  // `state` is the per-document memo ({ rotation }); pass the same object for
  // every page of one file. `deadline` skips the probe outright when there is
  // no time left to spend on it — a rough read now beats a perfect read never.
  //
  // `renderRotated(rotation, longEdge)` renders the page; longEdge is a
  // requested pixel size the caller may honour or ignore.
  // `wantBoxes` is forwarded only to the passes whose result is actually
  // returned. The orientation probes below are thrown away once they have
  // voted, so paying for their geometry would be pure waste.
  async function runOcrOriented(renderRotated, notify, state, deadline, wantBoxes) {
    const memo = state || {};
    if (memo.rotation != null) {
      return runOcrPass(await renderRotated(memo.rotation), notify, wantBoxes);
    }

    const first = await runOcrPass(await renderRotated(0), notify, wantBoxes);
    const outOfTime = deadline && Date.now() > deadline;
    if (first.confidence >= OCR_GOOD_CONFIDENCE || !first.chars || outOfTime) {
      // Only a confident pass settles the question for the whole document. A
      // page skipped for lack of time leaves the memo unset, so a later page
      // with time to spare can still establish the orientation.
      if (first.confidence >= OCR_GOOD_CONFIDENCE) memo.rotation = 0;
      return first;
    }

    // Upright is re-probed at the same small size as its rivals, so all four
    // scores are measured on equal terms — comparing a full-resolution upright
    // pass against downscaled rotations would favour upright every time.
    let bestRotation = 0;
    let bestScore = (await runOcrPass(await renderRotated(0, OCR_PROBE_LONG_EDGE), notify)).score;
    for (const rotation of OCR_ROTATION_RETRY_ORDER) {
      notify(`Text looks unclear — checking whether the page is rotated ${rotation}°…`);
      const probe = await runOcrPass(await renderRotated(rotation, OCR_PROBE_LONG_EDGE), notify);
      if (probe.score > bestScore) { bestScore = probe.score; bestRotation = rotation; }
      if (deadline && Date.now() > deadline) break;
    }
    memo.rotation = bestRotation;
    if (!bestRotation) return first;   // upright after all — keep the full-size read

    notify(`Page is rotated ${bestRotation}° — re-reading it that way up.`);
    return runOcrPass(await renderRotated(bestRotation), notify, wantBoxes);
  }

  // ---------- PDF: layout-aware line/table extraction ----------
  //
  // A fixed render scale reads a big landscape page (A4 landscape, 841pt wide)
  // at a very different pixel density from a small portrait one, and OCR
  // accuracy tracks pixel density, not zoom factor. Rendering to a target long
  // edge instead means every page reaches the recognizer at a comparable size,
  // whatever shape the document is.
  const OCR_TARGET_LONG_EDGE = 2200;
  const OCR_MIN_SCALE = 1.5;
  const OCR_MAX_SCALE = 4;

  // OCR_TARGET_LONG_EDGE is a floor, not a target, when the page IS a scan.
  // A scanned page carries its own pixels, and they are the ceiling on what any
  // recognizer can read from it — so rendering below them throws away detail the
  // file already has. Measured on `L260390185MZ signed contract.pdf`: 22 pages
  // of CCITTFax, natively 1654x2340 (200 dpi) on a 595x842pt page, which
  // OCR_TARGET_LONG_EDGE alone renders to 1555x2200. Losing 6% is mild; the same
  // arithmetic downsamples a 300 dpi scan by a third and halves a 600 dpi one.
  //
  // It matters more for a 1-bit fax scan than the percentages suggest. There is
  // no grey to average into: a stroke one pixel wide either survives the
  // resample or disappears, so what a colour scan loses as softness a bitonal
  // one loses as broken characters. `Docparse/CLAUDE.md` has the measurement
  // this rests on — the same four lines read as
  // "Hong Kon Telecomunictin HT Li e Y" at one resolution and
  // "Hong Kong Telecommunications (HKT) Limited" at twice it.
  //
  // Capped, because the page's own image is the only thing bounding this and a
  // 600 dpi A3 scan would otherwise cost OCR time proportional to its area for
  // detail no recognizer uses. 4400 is the upper rung of that same table.
  const OCR_NATIVE_MAX_LONG_EDGE = 4400;

  // How much bigger the scan has to be before its resolution is followed at all.
  //
  // This threshold is here because the measurement did NOT support the obvious
  // version of this change. Recognizing page 1 of that same contract in a real
  // browser, same model, same page:
  //
  //   | render      | read                  | confidence |
  //   | 1555x2200   | "Statement of Work"   | 0.980      |
  //   | 1654x2340   | "Statement of W ork"  | 0.956      |
  //
  // 6% more pixels is noise, and resampling noise cuts both ways — here it cost
  // a word. The gain measured in `Docparse/CLAUDE.md` came from DOUBLING the
  // resolution of a cropped strip, not from a few percent on a whole page. So a
  // scan only overrides the fixed target when it is enough bigger to matter:
  // 200 dpi on A4 (2340) stays at 2200 and reads exactly as it did before, while
  // 300 dpi (3508, ratio 1.59) and 600 dpi are followed.
  const OCR_NATIVE_MIN_GAIN = 1.15;

  // How far an image's proportions may sit from the page's and still be taken
  // for a scan OF that page. This is what separates the thing being read from
  // the decoration around it, and the two are not close: measured across the
  // documents in one real email, the scanned agreement's image matches its page
  // to four decimal places (1654x2340 on 595x842pt — delta 0.0000), while the
  // largest images on the text-layer ATQ are pasted-in screenshots
  // (3412x566, 3412x1047) sitting 0.40 and 0.55 away.
  //
  // Without this a page-wide logo would raise the whole page's render scale for
  // detail nobody reads. `aspect` is taken short-edge-over-long so a scan stored
  // transposed against a rotated page still matches.
  const OCR_NATIVE_ASPECT_TOLERANCE = 0.08;

  // The largest embedded image that plausibly IS this page's scan, in its own
  // pixels — 0 when the page has none, when none is shaped like the page, or
  // when pdf.js reports one in a form carrying no dimensions
  // (`paintImageXObjectRepeat` carries positions, not a size). Free in practice:
  // the operator list is parsed and cached by the render that follows anyway,
  // and this only runs on the OCR branch, so a light pass never pays for it.
  async function nativeImageLongEdge(page) {
    try {
      const base = page.getViewport({ scale: 1 });
      const aspect = (w, h) => Math.min(w, h) / (Math.max(w, h) || 1);
      const pageAspect = aspect(base.width, base.height);
      const ops = await page.getOperatorList();
      const OPS = pdfjsLib.OPS;
      let longest = 0;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const args = ops.argsArray[i];
        let w = 0, h = 0;
        if (ops.fnArray[i] === OPS.paintImageXObject) {
          w = Number(args && args[1]); h = Number(args && args[2]);
        } else if (ops.fnArray[i] === OPS.paintImageMaskXObject) {
          // A bitonal stencil arrives as a mask, whose size is on the argument
          // object rather than alongside it.
          const m = args && args[0];
          w = Number(m && m.width); h = Number(m && m.height);
        }
        if (!(w > 0) || !(h > 0)) continue;
        if (Math.abs(aspect(w, h) - pageAspect) > OCR_NATIVE_ASPECT_TOLERANCE) continue;
        longest = Math.max(longest, w, h);
      }
      return longest;
    } catch (e) {
      // A page whose content stream will not parse still gets read, at the
      // fixed target — this is an optimisation, not a precondition.
      return 0;
    }
  }

  // targetLongEdge defaults to the reading size; the orientation probe asks for
  // a smaller one, and is allowed below OCR_MIN_SCALE because it is not trying
  // to read the page, only to tell which way up it is.
  function ocrRenderScale(page, targetLongEdge) {
    const base = page.getViewport({ scale: 1 });
    const pageLongEdge = Math.max(base.width, base.height) || 1;
    if (targetLongEdge) return Math.max(0.5, targetLongEdge / pageLongEdge);
    return Math.min(OCR_MAX_SCALE, Math.max(OCR_MIN_SCALE, OCR_TARGET_LONG_EDGE / pageLongEdge));
  }

  // The reading pass, which may exceed OCR_MAX_SCALE when the page's own scan is
  // that big. The cap exists so a *fixed* target cannot blow up a small page
  // (2200 on a 400pt page is scale 5.5); a native-resolution target cannot do
  // that, because the image itself bounds it and OCR_NATIVE_MAX_LONG_EDGE bounds
  // the image. `nativeLongEdge` 0 falls straight back to the old behaviour.
  function ocrReadingScale(page, nativeLongEdge) {
    const fixed = ocrRenderScale(page);
    if (!nativeLongEdge) return fixed;
    const base = page.getViewport({ scale: 1 });
    const pageLongEdge = Math.max(base.width, base.height) || 1;
    const native = Math.min(OCR_NATIVE_MAX_LONG_EDGE, nativeLongEdge) / pageLongEdge;
    // Only a scan meaningfully bigger than the fixed render is followed — see
    // OCR_NATIVE_MIN_GAIN for the measurement that put this threshold here.
    return native >= fixed * OCR_NATIVE_MIN_GAIN ? native : fixed;
  }

  async function renderPageToDataUrl(page, scale, rotation) {
    // `rotation` is added to whatever the page already declares, so a PDF with
    // /Rotate 90 still starts from its own idea of upright.
    const viewport = page.getViewport({ scale, rotation: (page.rotate || 0) + rotation });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/png');
  }

  // `deadline` (a Date.now() timestamp, optional) bounds the OCR work only.
  // Reaching it stops further pages being recognized and returns the pages
  // already read, which is the difference between an attachment contributing
  // most of its fields and contributing none at all.
  async function processPdf(file, notify, deadline, opts) {
    const o = opts || {};
    notify('Opening PDF…');
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pageBlocksList = []; // per page: array of {type:'table'|'para', ...}
    const orientation = {};    // shared across pages — see runOcrOriented

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      notify(`Reading page ${pageNum} of ${doc.numPages}…`);
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const rawText = textContent.items.map(it => it.str).join(' ').trim();

      if (rawText.length > 20) {
        const lines = groupItemsIntoLines(textContent.items);
        const blocks = buildBlocks(lines);
        pageBlocksList.push({ pageNum, blocks, ocr: false });
      } else if (o.deferOcr) {
        // The page is scanned and we are not paying for it yet. Recorded as
        // owing a read rather than as unread:
        //   - `blocks: []` contributes nothing to plainText, fields or
        //     headings, so nothing downstream sees invented content;
        //   - `ocrPending` rather than `truncated` on purpose — pagesToInspect
        //     filters `truncated` pages out of the ink pass, and the ink pass
        //     is precisely what the light pass exists to keep. A scanned
        //     signature page must still be checked for a signature now.
        // No deadline check here: with no OCR to run there is nothing on this
        // branch that can overrun one.
        pageBlocksList.push({ pageNum, blocks: [], ocr: false, ocrPending: true });
      } else {
        if (deadline && Date.now() > deadline) {
          const note = `[Pages ${pageNum}-${doc.numPages} not read — time limit reached]`;
          notify(note);
          pageBlocksList.push({ pageNum, blocks: [{ type: 'para', lines: [note] }], ocr: false, truncated: true });
          break;
        }
        notify(`Page ${pageNum} looks scanned — running OCR…`);
        // Asked once per page, not per pass: the orientation probe deliberately
        // renders small and must keep doing so.
        const nativeLongEdge = await nativeImageLongEdge(page);
        const pass = await runOcrOriented(
          (rotation, longEdge) => renderPageToDataUrl(page,
            longEdge ? ocrRenderScale(page, longEdge) : ocrReadingScale(page, nativeLongEdge), rotation),
          notify, orientation, deadline, o.markContext
        );
        // `ocrBoxes` only exists under markContext, and `pages` is part of the
        // result — a two-argument parseFile must not grow the property.
        const entry = { pageNum, blocks: pass.blocks, ocr: true };
        if (o.markContext && pass.boxes) entry.ocrBoxes = pass.boxes;
        pageBlocksList.push(entry);
      }
    }

    // Marks carried over from an earlier pass over this same document, so a
    // re-parse does not pay the ink budget twice. Applied before the pass
    // below, which then finds nothing left wanting.
    if (o.seedMarks) {
      pageBlocksList.forEach(entry => {
        if (Object.prototype.hasOwnProperty.call(o.seedMarks, entry.pageNum)) {
          entry.marks = o.seedMarks[entry.pageNum];
        }
      });
    }

    // A second pass, not part of the loop above: which pages are worth looking
    // at for ink depends on what the text turned out to say, and that is only
    // known once every page has been read.
    if (canInspectInk()) {
      await inspectPagesForMarks(doc, pageBlocksList, notify, orientation.rotation || 0, o.inkBudgetMs, deadline, o.markContext, o.markCrop);
    }
    return pageBlocksList;
  }

  function groupItemsIntoLines(items) {
    const clusters = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5];
      const x = it.transform[4];
      const fontSize = Math.abs(it.transform[0]) || 10;
      let cluster = clusters.find(c => Math.abs(c.y - y) <= 2.5);
      if (!cluster) { cluster = { y, items: [] }; clusters.push(cluster); }
      cluster.items.push({ str: it.str, x, width: it.width || 0, fontSize });
    }
    clusters.sort((a, b) => b.y - a.y); // top to bottom (PDF space is y-up)
    for (const c of clusters) c.items.sort((a, b) => a.x - b.x);

    const gaps = [];
    for (let i = 1; i < clusters.length; i++) gaps.push(clusters[i - 1].y - clusters[i].y);
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;

    return clusters.map((c, i) => {
      const { text, cells, cellStarts, cellParts } = lineItemsToCellsAndText(c.items);
      // Cap the median: on sparse pages the median gap balloons, which would
      // merge unrelated sections (header + table + totals) into one.
      const base = Math.min(medianGap, 20);
      const yGapBefore = i > 0 ? (clusters[i - 1].y - c.y) : 0;
      const bigGapBefore = i > 0 && yGapBefore > Math.max(base * 1.7, base + 6);
      return {
        text, cells, cellStarts, cellParts, yGapBefore,
        // The gap measured against this page's own line spacing, so a section
        // break can be told from a merely roomy table row. See continuesTable.
        gapRatio: base > 0 ? yGapBefore / base : 0,
        bigGapBefore: i === 0 ? false : bigGapBefore,
      };
    }).filter(l => l.text !== '');
  }

  function lineItemsToCellsAndText(items) {
    const cells = [];
    const cellStarts = [];
    // Where each fragment of a cell's text sits. A cell whose text runs right
    // up against the next column leaves no gap to split on, so the two columns
    // arrive fused; these positions are the only remaining evidence of the
    // boundary. See cellSegments().
    const cellParts = [];
    let current = [];
    let currentStart = null;
    let prevEndX = null;
    for (const it of items) {
      const gapThreshold = Math.max(10, it.fontSize * 2);
      if (prevEndX !== null && (it.x - prevEndX) > gapThreshold) {
        cells.push(current.map(p => p.str).join(' ').trim());
        cellStarts.push(currentStart);
        cellParts.push(current);
        current = [];
        currentStart = null;
      }
      if (currentStart === null) currentStart = it.x;
      current.push({ x: it.x, str: it.str });
      prevEndX = it.x + it.width;
    }
    if (current.length) {
      cells.push(current.map(p => p.str).join(' ').trim());
      cellStarts.push(currentStart);
      cellParts.push(current);
    }
    const keep = cells.map((c, i) => ({ c, x: cellStarts[i], parts: cellParts[i] })).filter(o => o.c !== '');
    const cellsFiltered = keep.map(o => o.c);
    const startsFiltered = keep.map(o => o.x);
    return {
      text: cellsFiltered.join('   '),
      cells: cellsFiltered,
      cellStarts: startsFiltered,
      cellParts: keep.map(o => o.parts),
    };
  }

  // Cluster x-start positions into stable column positions. Used both to
  // spot genuine data tables (many rows sharing 3+ columns) and side-by-side
  // boxes like "From: / To:" (2-3 short columns) that need to be read one
  // column fully before the next, not row-by-row across the page.
  function clusterColumnStarts(lines, tolerance) {
    const starts = [];
    lines.forEach(l => l.cellStarts.forEach(x => starts.push(x)));
    starts.sort((a, b) => a - b);
    const clusters = [];
    for (const x of starts) {
      let c = clusters.find(c => Math.abs(c.center - x) <= tolerance);
      if (c) { c.xs.push(x); c.center = c.xs.reduce((a, b) => a + b, 0) / c.xs.length; }
      else clusters.push({ center: x, xs: [x] });
    }
    return clusters.map(c => c.center).sort((a, b) => a - b);
  }

  function nearestColumnIndex(x, cols) {
    let best = 0, bestDist = Infinity;
    cols.forEach((c, i) => { const d = Math.abs(c - x); if (d < bestDist) { bestDist = d; best = i; } });
    return best;
  }

  // How close a word must start to a column position to count as standing IN
  // that column rather than merely having drifted near it.
  const COLUMN_SNAP = 8;

  // "Approver-1", "Item 2" — a form numbering its own slots. Nothing else in a
  // document looks like this, which is why it can stand in as evidence that a
  // column is a label column.
  const SERIES_LABEL_RE = /^[A-Za-z][A-Za-z ]{1,20}[-–—]?\s?\d{1,2}$/;

  // One cell, resolved into the column(s) it actually occupies. Normally that
  // is a single column and this just answers nearestColumnIndex. But a cell
  // whose text abuts the next column's text — no whitespace gap for the cell
  // splitter to find — carries two columns' worth of content ("Networking -
  // Huawei products - H/W + S/W (On-Site by"), and only the word positions
  // still know where one ends. A word is treated as starting a new cell only
  // when it lands ON a later column; drifting closer to one is not enough, or
  // any wide paragraph would be chopped at every column it crosses.
  function cellSegments(line, i, cols) {
    const first = nearestColumnIndex(line.cellStarts[i], cols);
    const parts = line.cellParts && line.cellParts[i];
    if (!parts || parts.length < 2) return [{ ci: first, text: line.cells[i] }];
    const segs = [{ ci: first, words: [] }];
    for (const p of parts) {
      const ci = nearestColumnIndex(p.x, cols);
      const cur = segs[segs.length - 1];
      if (ci > cur.ci && Math.abs(p.x - cols[ci]) <= COLUMN_SNAP) segs.push({ ci, words: [p.str] });
      else cur.words.push(p.str);
    }
    return segs
      .map(s => ({ ci: s.ci, text: s.words.join(' ').replace(/\s+/g, ' ').trim() }))
      .filter(s => s.text);
  }

  // Every cell of a line, resolved to columns — the row-building form of
  // cellSegments.
  function lineSegments(line, cols) {
    const out = [];
    line.cells.forEach((_, i) => out.push(...cellSegments(line, i, cols)));
    return out;
  }

  // Narrow table columns wrap their cell text onto extra physical lines
  // ("Interna" / "tional" / "Ltd", or a label wrapping to a second line).
  // A line is a wrapped continuation of the row above — not a new row —
  // when it sits at tight line-spacing AND its cells occupy a strict
  // subset of the columns the row already uses. Merge such lines back
  // into their row before any table/column/field analysis.
  function mergeWrappedRows(lines) {
    if (lines.length < 2) return lines;

    // Estimate spacing. Wrapped lines only exist where the section shows
    // TWO gap scales: a tight wrap gap (single line-height) clearly smaller
    // than the typical row gap. Uniform spacing = every line is its own
    // row — merging must stay off or distinct rows would glue together.
    const gaps = lines.slice(1).map(l => l.yGapBefore).filter(g => g > 0).sort((a, b) => a - b);
    if (!gaps.length) return lines;
    const lineH = gaps[0];
    const rowGapMed = gaps[Math.floor(gaps.length / 2)];
    if (rowGapMed <= lineH * 1.4) return lines;   // no bimodal spacing -> no wraps
    const tight = lineH * 1.25;
    const COL_TOL = 14;

    const rows = [];
    for (const line of lines) {
      const row = rows.length ? rows[rows.length - 1] : null;
      let isContinuation = false;

      if (row && line.yGapBefore > 0 && line.yGapBefore <= tight) {
        // every cell must land on an existing row column, and the line must
        // cover FEWER columns than the row (a full-width line is a new row)
        const rowCols = row.cellStarts;
        const matches = line.cellStarts.map(x => {
          let best = -1, bestD = Infinity;
          rowCols.forEach((cx, ci) => {
            const d = Math.abs(cx - x);
            if (d < bestD) { bestD = d; best = ci; }
          });
          return bestD <= COL_TOL ? best : -1;
        });
        const allMatch = matches.every(m => m >= 0);
        const distinct = new Set(matches).size;
        // A genuine wrap continues exactly ONE cell of the row above. A
        // line touching two or more columns is a new record — otherwise
        // consecutive form rows at tight spacing chain-merge into a blob.
        if (allMatch && rowCols.length >= 2 && distinct === 1) isContinuation = true;
      }

      if (isContinuation) {
        const row2 = rows[rows.length - 1];
        line.cellStarts.forEach((x, i) => {
          let best = 0, bestD = Infinity;
          row2.cellStarts.forEach((cx, ci) => {
            const d = Math.abs(cx - x);
            if (d < bestD) { bestD = d; best = ci; }
          });
          row2.cells[best] = (row2.cells[best] + ' ' + line.cells[i]).trim();
          // The wrapped line's word positions travel with its text: a cell
          // that fuses two columns can still be split after merging.
          if (row2.cellParts[best] && line.cellParts && line.cellParts[i]) {
            row2.cellParts[best] = row2.cellParts[best].concat(line.cellParts[i]);
          }
        });
        row2.text = row2.cells.join('   ');
      } else {
        rows.push({
          text: line.text,
          cells: line.cells.slice(),
          cellStarts: line.cellStarts.slice(),
          cellParts: (line.cellParts || []).map(p => p.slice()),
          yGapBefore: line.yGapBefore,
          gapRatio: line.gapRatio,
          bigGapBefore: line.bigGapBefore,
        });
      }
    }
    return rows;
  }

  function buildBlocks(lines) {
    // First split into "sections" at big vertical gaps — each section is
    // handled independently as a table, a set of side-by-side columns, or
    // a plain paragraph.
    const sections = [];
    let cur = [];
    for (const l of lines) {
      if (l.bigGapBefore && cur.length) { sections.push(cur); cur = []; }
      cur.push(l);
    }
    if (cur.length) sections.push(cur);

    const blocks = [];
    for (const section of rejoinTableSections(sections)) {
      blocks.push(...classifySection(mergeWrappedRows(section)));
    }
    return blocks;
  }

  // A wide table sets its rows further apart than the wrapped lines inside one
  // row — on the ATQ cost table, 21pt between items against 12pt within one —
  // so the row gaps read as section breaks and every item after the first fell
  // out of the table as loose paragraphs. Vertically the two gaps are the same
  // thing; what tells them apart is that a table's columns carry on across the
  // gap while a genuinely new block starts its own.
  const REJOIN_COLUMN_TOLERANCE = 14;
  const REJOIN_MIN_SHARED_COLUMNS = 3;
  // A table's row gap is only a little wider than the wrap gap inside a row —
  // just wide enough to have been called a section break. A real change of
  // subject leaves far more room than that, and must not be rejoined however
  // well the columns happen to line up.
  const REJOIN_MAX_GAP_RATIO = 2.2;

  function rejoinTableSections(sections) {
    const out = [];
    for (const section of sections) {
      const prev = out[out.length - 1];
      if (prev && continuesTable(prev, section)) prev.push(...section);
      else out.push(section.slice());
    }
    return out;
  }

  function continuesTable(a, b) {
    // Both halves must look like table rows in the first place: a caption or a
    // paragraph that happens to sit under a table shares no columns with it.
    if (!a.some(l => l.cells.length >= 3) || !b.some(l => l.cells.length >= 3)) return false;
    if (!(b[0].gapRatio <= REJOIN_MAX_GAP_RATIO)) return false;
    const colsA = clusterColumnStarts(a, 22);
    const colsB = clusterColumnStarts(b, 22);
    if (colsB.length < REJOIN_MIN_SHARED_COLUMNS) return false;
    // EVERY column below must be one of the columns above. A later row of the
    // same table uses a subset of its columns; an unrelated block that merely
    // overlaps in a few places brings columns of its own, and those are what
    // give it away.
    return colsB.every(x => colsA.some(y => Math.abs(x - y) <= REJOIN_COLUMN_TOLERANCE));
  }

  function classifySection(section) {
    const multiCellLines = section.filter(l => l.cells.length >= 2);

    // Not enough multi-cell lines to suggest any column structure — plain
    // single-column paragraph.
    if (multiCellLines.length < 2) {
      return [{ type: 'para', lines: section.map(l => l.text) }];
    }

    // Each line is already a self-contained "Label: value" pair (e.g. a
    // block of "Title: ...", "Region.ID: ...", "Company Code: ..." lines).
    // Leave these as plain paragraph lines — splitting into columns would
    // separate every label from its own value. The field extractor already
    // handles this pattern per line.
    const inlineLineCount = section.filter(l => matchInline(l.text)).length;
    if (inlineLineCount >= Math.ceil(section.length * 0.5)) {
      return [{ type: 'para', lines: section.map(l => l.text) }];
    }

    const cols = clusterColumnStarts(section, 22);

    // A genuine data table: several distinct columns, AND at least two
    // separate rows that each span most of those columns (not just one
    // side-by-side line where every other row only touches a single
    // column — that pattern is boxes to read one at a time, not a grid).
    if (cols.length >= 3) {
      const colHitCounts = cols.map(() => 0);
      section.forEach(l => {
        const hitCols = new Set(l.cellStarts.map(x => nearestColumnIndex(x, cols)));
        hitCols.forEach(ci => colHitCounts[ci]++);
      });
      const strongCols = colHitCounts.filter(c => c >= 2).length;
      const wideRows = section.filter(l => l.cells.length >= Math.max(2, cols.length - 1)).length;
      if (strongCols >= 3 && wideRows >= 2) {
        const rows = section.map(l => {
          const row = cols.map(() => '');
          lineSegments(l, cols).forEach(s => {
            row[s.ci] = row[s.ci] ? row[s.ci] + ' ' + s.text : s.text;
          });
          return row;
        });
        return [{ type: 'table', rows }];
      }

      // Uneven table: one column (e.g. a Remarks/description field) wraps
      // across many more visual lines than the others (e.g. Date, Name),
      // so no single line spans "most" columns and the check above misses
      // it. A new row starts wherever a line has content in BOTH the first
      // column and at least one other — a wrapped continuation line (just
      // "PM", or a remark's second line) never repeats the first column.
      if (strongCols >= 3 && colHitCounts[0] >= 2) {
        const rows = [];
        let cur = null;
        let rowStartCount = 0;
        for (const l of section) {
          // Where a row STARTS is judged from the cells the layout pass found,
          // not from cellSegments' finer split: splitting a fused cell adds
          // columns to a line, and letting that decide would turn documents
          // that are laid out as side-by-side boxes into tables.
          const distinctCols = new Set(
            l.cellStarts.map(x => nearestColumnIndex(x, cols)));
          const hits = lineSegments(l, cols);
          const isRowStart = distinctCols.has(0) && distinctCols.size >= Math.min(3, cols.length);
          if (isRowStart) rowStartCount++;
          if (isRowStart || !cur) {
            cur = cols.map(() => '');
            rows.push(cur);
          }
          hits.forEach(h => { cur[h.ci] = cur[h.ci] ? cur[h.ci] + ' ' + h.text : h.text; });
        }
        // ≥2 genuine row starts = a real repeating-record table; with only
        // one, this grouping would swallow unrelated neighbors into it.
        if (rows.length >= 2 && rowStartCount >= 2) return [{ type: 'table', rows }];
      }
    }

    // Side-by-side boxes — read each column fully before the next. Two
    // pairing refinements first:
    //  (a) a column made of ":" cells means "label col : value col" — pair
    //      label[i] with value[i] when counts line up;
    //  (b) exactly two columns, equal length, left all label-ish, right not
    //      (e.g. Total USD | 150,874.52) — pair by row.
    if (cols.length >= 2) {
      const colCells = cols.map(() => []);
      section.forEach(l => {
        l.cells.forEach((cellText, i) => {
          const ci = nearestColumnIndex(l.cellStarts[i], cols);
          colCells[ci].push(cellText);
        });
      });

      // (a) colon columns
      const isColonCol = colCells.map(cells =>
        cells.length >= 2 && cells.filter(c => c === ':' || c === '：').length / cells.length >= 0.8);
      if (isColonCol.some(Boolean)) {
        const consumed = cols.map(() => false);
        const out = [];
        for (let c = 0; c < cols.length; c++) {
          if (!isColonCol[c]) continue;
          consumed[c] = true;
          const lc = c - 1, vc = c + 1;
          if (lc >= 0 && vc < cols.length && !consumed[lc] && !consumed[vc] &&
              colCells[lc].length === colCells[vc].length && colCells[lc].length >= 2 &&
              colCells[lc].every(x => isLabelish(x))) {
            const lines = colCells[lc].map((lab, i) => lab + ': ' + colCells[vc][i]);
            out.push({ type: 'para', lines });
            consumed[lc] = true;
            consumed[vc] = true;
          }
        }
        for (let c = 0; c < cols.length; c++) {
          if (!consumed[c] && colCells[c].length) out.push({ type: 'para', lines: colCells[c] });
        }
        if (out.length) return out;
      }

      // (b) label/value form box with 2 or 4 alternating columns (labels in
      // even columns, values in odd) — walk row by row so wrapped value
      // lines continue the previous label's value. Handles colon-less forms
      // like "Customer Number | INTPCCW0007 | Customer Name | PCCW ...".
      //
      // With two columns the shape alone is ambiguous — "Proposed New
      // Contract | Previous Contract" is a heading, not a field — so a value
      // column that reads like more labels normally disqualifies it. That test
      // also rejects genuine forms whose values happen to be names ("Approver-1
      // | Cheung, Sindy SY (Sub-Team Leader)"), so a left column that is
      // plainly a form's own label column — known labels, or a numbered series
      // — is accepted on that evidence instead.
      const namesItsOwnFields = colCells[0].filter(x =>
        isKnownLabel(x) || SERIES_LABEL_RE.test(x)).length / colCells[0].length >= 0.6;
      const alternating = (cols.length === 2 || cols.length === 4) &&
        [0, 2].filter(k => k < cols.length).every(k =>
          colCells[k].length >= 2 && colCells[k].every(x => isLabelish(x))) &&
        (cols.length === 4 || namesItsOwnFields ||
          colCells[1].filter(x => isLabelish(x)).length / colCells[1].length <= 0.6);
      if (alternating) {
        const lines = [];
        const cur = {};   // pair index -> accumulating "Label: value" text
        // A form slot nobody filled in ("Approver-7") is finished the moment
        // the next label starts. Emitting it as a bare "Approver-7:" line
        // would leave a label looking for a value, and the field extractor
        // would hand it the next slot's label.
        const done = text => { if (text && !/[:：]\s*$/.test(text)) lines.push(text); };
        for (const l of section) {
          const byCol = cols.map(() => []);
          lineSegments(l, cols).forEach(s => byCol[s.ci].push(s.text));
          for (let p = 0; p < cols.length / 2; p++) {
            const label = byCol[p * 2].join(' ').trim();
            const value = (byCol[p * 2 + 1] || []).join(' ').trim();
            if (label) {
              done(cur[p]);
              cur[p] = label.replace(/[:：]\s*$/, '') + ': ' + value;
            } else if (value && cur[p]) {
              cur[p] += ' ' + value;
            } else if (value) {
              lines.push(value);
            }
          }
        }
        Object.keys(cur).forEach(p => done(cur[p]));
        return [{ type: 'para', lines }];
      }

      return colCells
        .filter(lns => lns.length)
        .map(lns => ({ type: 'para', lines: lns }));
    }

    return [{ type: 'para', lines: section.map(l => l.text) }];
  }

  // ---------- Images: OCR via PaddleOCR, full layout pipeline ----------
  //
  // A photographed or scanned page arrives as whatever way up the camera held
  // it, with no /Rotate to consult, so images get the same orientation probe
  // PDFs do — via a canvas, since there is no viewport to ask.
  function rotateDataUrl(dataUrl, rotation, longEdge) {
    if (!rotation && !longEdge) return Promise.resolve(dataUrl);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Only ever shrinks: enlarging an image invents no detail for the
        // recognizer and costs it time proportional to the area.
        const zoom = longEdge ? Math.min(1, longEdge / Math.max(img.width, img.height)) : 1;
        const w = Math.max(1, Math.round(img.width * zoom));
        const h = Math.max(1, Math.round(img.height * zoom));
        const swap = rotation === 90 || rotation === 270;
        const canvas = document.createElement('canvas');
        canvas.width = swap ? h : w;
        canvas.height = swap ? w : h;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not decode image for rotation'));
      img.src = dataUrl;
    });
  }

  async function processImage(file, notify, deadline, opts) {
    const o = opts || {};
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read image file'));
      r.readAsDataURL(file);
    });
    let entry, rotation = 0, ocrBoxes = null;
    if (o.deferOcr) {
      // An image has no text layer to fall back on — it is 100% OCR, so
      // deferring it is not optional the way a scanned PDF page's OCR is.
      entry = { pageNum: 1, blocks: [], ocr: false, ocrPending: true };
    } else {
      const orientation = {};
      const pass = await runOcrOriented(
        (rotation, longEdge) => rotateDataUrl(dataUrl, rotation, longEdge),
        notify, orientation, deadline, o.markContext
      );
      entry = { pageNum: 1, blocks: pass.blocks, ocr: true };
      if (o.markContext && pass.boxes) { entry.ocrBoxes = pass.boxes; ocrBoxes = pass.boxes; }
      rotation = orientation.rotation || 0;
    }
    // The ink/signature pass runs either way — that is exactly the part the
    // light pass exists to keep doing immediately, deferred OCR or not.
    if (canInspectInk()) {
      notify('Checking for a signature or company chop…');
      entry.marks = await inspectDataUrl(dataUrl, rotation, notify,
        (o.markContext || o.markCrop)
          ? { markContext: o.markContext, markCrop: o.markCrop, ocrBoxes }
          : undefined);
    }
    return [entry];
  }

  // ---------- Signature and company-chop detection ----------
  //
  // A signed agreement and the blank one that was sent out for signing hold
  // exactly the same words, so no amount of text extraction tells them apart.
  // The difference is ink that was never typed — a handwritten signature, and
  // on a company document usually a chop — and that exists only in the pixels.
  // So the page is rendered small and what is on it is examined as shapes and
  // colour rather than read as text.
  //
  // Three observations carry the whole detector:
  //   - printed text is thousands of small ink blobs of very uniform size;
  //   - a signature is ONE sprawling stroke several times the size of any
  //     glyph, and mostly empty inside its own bounding box;
  //   - a chop is coloured, and on a business document almost nothing else is.
  //
  // Everything below is a heuristic on a low-resolution render. It answers
  // "does this look signed", not "is this signature genuine", and it is meant
  // to be reported as a finding a person then confirms.

  // Working raster. Small enough that a 20-page contract is affordable, large
  // enough that neighbouring printed characters stay separate blobs — which is
  // the property the whole size comparison rests on. At 1000 a dense A4
  // contract renders its body type five pixels tall and a light pen stroke
  // breaks up into specks too small to measure; 1400 is where that stopped.
  const INK_LONG_EDGE = 1400;
  const INK_DARK_RATIO = 0.78;      // darker than this share of the paper = ink
  const INK_MIN_SAT = 0.30;         // deliberate colour, not JPEG fringing round black text
  const INK_MIN_COMPONENT = 6;      // pixels; below this it is scanner speckle

  function canInspectInk() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  // ---- pixel preparation ----

  // Paper is whatever most of the page is. Taking a high percentile rather
  // than the maximum keeps a single white speck or a blown-out highlight from
  // setting the reference for a grey photocopy, where the "white" is 0.75.
  function paperLuminance(lum) {
    const bins = new Int32Array(64);
    for (let i = 0; i < lum.length; i++) bins[Math.min(63, (lum[i] * 63) | 0)]++;
    const target = lum.length * 0.9;
    let seen = 0;
    for (let b = 0; b < 64; b++) {
      seen += bins[b];
      if (seen >= target) return Math.max(0.25, (b + 0.5) / 64);
    }
    return 1;
  }

  function hueDegrees(r, g, b, max, min) {
    const d = max - min;
    if (d <= 0) return -1;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  // Red covers every ink a company chop is made in here; blue-through-violet
  // covers the pads used for signature chops and some bank stamps. Green and
  // yellow are excluded on purpose — they are highlighter and letterhead.
  // The red band reaches back to 315° so that magenta counts as warm rather
  // than as nothing: a magenta wordmark is the one piece of letterhead artwork
  // shaped enough like handwriting to be mistaken for it, and leaving a gap
  // between the two bands let it through as colourless.
  function chopHueBand(h) {
    if (h < 0) return null;
    if (h <= 25 || h >= 315) return 'red';
    if (h >= 195 && h < 315) return 'blue';
    return null;
  }

  function inkMasks(data, w, h) {
    const n = w * h;
    const lum = new Float32Array(n);
    const ink = new Uint8Array(n);
    const color = new Uint8Array(n);
    const hue = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3] / 255;
      // Transparent is paper, not ink — a PDF page rendered onto a bare canvas
      // has no white behind it, and every unpainted pixel would read as black.
      const r = (data[i * 4] / 255) * a + (1 - a);
      const g = (data[i * 4 + 1] / 255) * a + (1 - a);
      const b = (data[i * 4 + 2] / 255) * a + (1 - a);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      hue[i] = hueDegrees(r, g, b, max, min);
      color[i] = max > 0 && (max - min) / max >= INK_MIN_SAT ? 1 : 0;
    }
    const paper = paperLuminance(lum);
    const darkBelow = paper * INK_DARK_RATIO;
    for (let i = 0; i < n; i++) ink[i] = lum[i] < darkBelow ? 1 : 0;
    // A chop is bright red, often lighter than the print it sits on, so colour
    // is judged on saturation and only excluded where it is as pale as paper.
    for (let i = 0; i < n; i++) if (color[i] && lum[i] > paper * 0.97) color[i] = 0;
    return { ink, color, hue, paper };
  }

  // ---- connected components ----

  // Iterative 8-connected flood fill. Recursion would blow the stack on a
  // table border, which is routinely one component snaking across a whole page.
  // Pixels are handed to `measure` one component at a time and then forgotten,
  // so peak memory is one page's masks and not one array per blob.
  function forEachComponent(mask, w, h, minArea, measure) {
    const seen = new Uint8Array(mask.length);
    const stack = new Int32Array(mask.length);
    const pixels = new Int32Array(mask.length);
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      let sp = 0, count = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      while (sp > 0) {
        const p = stack[--sp];
        pixels[count++] = p;
        const x = p % w, y = (p / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx;
            if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
          }
        }
      }
      if (count >= minArea) measure(pixels, count, minX, minY, maxX, maxY);
    }
  }

  // Two shape numbers per blob, both scale-free:
  //
  // `solidity` — the share of its pixels that are completely surrounded by ink.
  // A filled logo is nearly all interior; a pen stroke has almost none, because
  // every pixel of a thin line is on its edge.
  //
  // `ruleRatio` — the share of its pixels sitting in a row or column that is
  // itself almost as long as the blob AND long in absolute terms. This is what
  // separates a signature from a table's border: both are large, thin and
  // hollow, but a table is made of long straight rules and a signature is not.
  //
  // `minRun` is what makes "rule" mean anything. Without it, a 30-pixel-wide
  // flourish in a script hand counts its own horizontal sweep as a rule and
  // the signature it belongs to is thrown away as furniture. A real rule on a
  // real page is long; a stroke inside one letter is not.
  function componentShape(pixels, count, minX, minY, maxX, maxY, mask, imgW, imgH, hue, minRun) {
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const rows = new Int32Array(bh), cols = new Int32Array(bw);
    let interior = 0, red = 0, blue = 0;
    for (let k = 0; k < count; k++) {
      const p = pixels[k];
      const x = p % imgW, y = (p / imgW) | 0;
      rows[y - minY]++;
      cols[x - minX]++;
      if (x > 0 && x < imgW - 1 && y > 0 && y < imgH - 1 &&
          mask[p - 1] && mask[p + 1] && mask[p - imgW] && mask[p + imgW]) interior++;
      if (hue) {
        const band = chopHueBand(hue[p]);
        if (band === 'red') red++;
        else if (band === 'blue') blue++;
      }
    }
    const run = minRun || 0;
    let ruled = 0;
    for (let i = 0; i < bh; i++) if (rows[i] >= bw * 0.6 && rows[i] >= run) ruled += rows[i];
    for (let i = 0; i < bw; i++) if (cols[i] >= bh * 0.6 && cols[i] >= run) ruled += cols[i];
    return {
      x: minX, y: minY, w: bw, h: bh, area: count,
      fill: count / (bw * bh),
      solidity: interior / count,
      ruleRatio: Math.min(1, ruled / count),
      red, blue,
      // Only blobs big enough to be a stamp are asked the question — the hole
      // test walks the whole bounding box, and doing that for every speck of
      // printed punctuation on the page would cost more than the rest of the
      // detector put together.
      hole: (bw >= 10 && bh >= 10 && count >= 40)
        ? largestHoleRatio(pixels, count, imgW, minX, minY, maxX, maxY) : 0,
    };
  }

  // ---- signature ----

  // Sized against the page's own printing rather than against absolute pixels,
  // so the same numbers hold for a dense A4 contract and a large-type cover
  // sheet. A signature is bigger than the type around it by a wide margin.
  const SIG_MIN_HEIGHT_X_GLYPH = 2.2;
  const SIG_MIN_WIDTH_X_GLYPH = 5;
  const SIG_MAX_FILL = 0.40;
  // Solidity is really a stroke-thickness measure, and thickness is measured
  // in pixels: the same pen stroke reads 0.2 at one render size and 0.5 at
  // another, which once cost a real signature its detection when the raster
  // grew. So it is kept only as a coarse "is this a filled shape" guard, and
  // the work of recognising handwriting is left to fill and size, which are
  // ratios and do not move with resolution.
  const SIG_MAX_SOLIDITY = 0.55;
  const SIG_MAX_RULE_RATIO = 0.30;
  const SIG_MIN_ASPECT = 1.2;       // signatures run along the line, not down it
  const SIG_MAX_ASPECT = 14;
  const SIG_MAX_PAGE_WIDTH = 0.75;  // wider than this and it is a rule or a border
  const SIG_MAX_PAGE_HEIGHT = 0.30;
  const SIG_MAX_WARM_INK = 0.5;     // share of red-family pixels a pen would never have

  function median(values) {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // A signature is rarely one unbroken stroke. Lift the pen once, or scan at a
  // resolution where a thin stroke drops out in places, and "Cherie Wong"
  // arrives as four separate blobs, none of them large enough on its own to be
  // anything. They have to be put back together before they can be judged.
  //
  // Only blobs that are ALREADY unlike printing are eligible to be joined —
  // taller than the type and not solid — which is what stops this from
  // stitching the letters of an ordinary word into a "signature".
  const SIG_GROUP_MIN_HEIGHT_X_GLYPH = 1.6;
  const SIG_GROUP_MAX_FILL = 0.55;
  const SIG_GROUP_MAX_SOLIDITY = 0.60;
  const SIG_GROUP_GAP_X_GLYPH = 2;

  function mergeStrokeGroups(candidates, glyphH) {
    const gap = glyphH * SIG_GROUP_GAP_X_GLYPH;
    const groups = [];
    for (const c of candidates.slice().sort((a, b) => a.x - b.x)) {
      // Along the line, a gap; across it, nothing. The strokes of one
      // signature share a band, and requiring them to actually overlap in it
      // is what stops a logo being stitched to the heading underneath it and
      // the pair being read as one very irregular hand.
      const near = groups.find(g =>
        c.x <= g.x + g.w + gap &&
        Math.min(c.y + c.h, g.y + g.h) > Math.max(c.y, g.y));
      if (near) {
        const x1 = Math.max(near.x + near.w, c.x + c.w), y1 = Math.max(near.y + near.h, c.y + c.h);
        near.x = Math.min(near.x, c.x);
        near.y = Math.min(near.y, c.y);
        near.w = x1 - near.x;
        near.h = y1 - near.y;
        near.area += c.area;
        near.parts.push(c);
        near.red += c.red;
        near.blue += c.blue;
      } else {
        groups.push({ x: c.x, y: c.y, w: c.w, h: c.h, area: c.area, red: c.red, blue: c.blue, parts: [c] });
      }
    }
    // Averages weighted by ink, so one large stroke is not outvoted by a dot.
    for (const g of groups) {
      const total = g.area || 1;
      g.fill = g.area / (g.w * g.h);
      g.solidity = g.parts.reduce((s, p) => s + p.solidity * p.area, 0) / total;
      g.ruleRatio = g.parts.reduce((s, p) => s + p.ruleRatio * p.area, 0) / total;
      g.hole = Math.max.apply(null, g.parts.map(p => p.hole));
    }
    return groups;
  }

  // Printing sits on a baseline. Every letter of a word ends at the same
  // height and they are all much the same size; handwriting does neither. When
  // a group is made of four or more pieces that line up that precisely it is a
  // printed word — in practice a heading, which is the only printing on a page
  // big enough to reach the size tests in the first place.
  // Six, not four: a real signature broken into four or five strokes can line
  // up well enough to look regular by chance, and two of the signed documents
  // here are exactly that. A printed heading has more letters than that.
  const TEXT_MIN_PARTS = 6;
  const TEXT_BASELINE_SPREAD = 0.16;   // of the group's own height
  const TEXT_HEIGHT_SPREAD = 0.28;     // of the mean piece height

  function spread(values) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
    return { mean, sd: Math.sqrt(variance) };
  }

  function looksLikePrintedWord(group) {
    if (group.parts.length < TEXT_MIN_PARTS) return false;
    const baseline = spread(group.parts.map(p => p.y + p.h));
    const heights = spread(group.parts.map(p => p.h));
    return baseline.sd <= group.h * TEXT_BASELINE_SPREAD &&
           heights.sd <= heights.mean * TEXT_HEIGHT_SPREAD;
  }

  // When the PDF carries a text layer it has already told us, exactly, where
  // its typed characters are. Ink that sits on top of that is printing by the
  // document's own account — no heuristic needed — and this is what stops the
  // printed words "Authorised Signature" under an empty signature line from
  // being reported as a signature on an unsigned quotation. Scans have no such
  // layer and fall back on shape alone.
  const TEXT_MASK_CELL = 8;
  const SIG_MAX_TEXT_COVER = 0.6;

  function buildTextMask(boxes, w, h) {
    const gw = Math.ceil(w / TEXT_MASK_CELL), gh = Math.ceil(h / TEXT_MASK_CELL);
    const grid = new Uint8Array(gw * gh);
    for (const b of boxes || []) {
      const x0 = Math.max(0, Math.floor(b.x / TEXT_MASK_CELL));
      const y0 = Math.max(0, Math.floor(b.y / TEXT_MASK_CELL));
      const x1 = Math.min(gw - 1, Math.floor((b.x + b.w) / TEXT_MASK_CELL));
      const y1 = Math.min(gh - 1, Math.floor((b.y + b.h) / TEXT_MASK_CELL));
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) grid[gy * gw + gx] = 1;
    }
    return { grid, gw, gh };
  }

  function textCoverage(box, mask) {
    if (!mask) return 0;
    const x0 = Math.max(0, Math.floor(box.x / TEXT_MASK_CELL));
    const y0 = Math.max(0, Math.floor(box.y / TEXT_MASK_CELL));
    const x1 = Math.min(mask.gw - 1, Math.floor((box.x + box.w) / TEXT_MASK_CELL));
    const y1 = Math.min(mask.gh - 1, Math.floor((box.y + box.h) / TEXT_MASK_CELL));
    let cells = 0, covered = 0;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        cells++;
        if (mask.grid[gy * mask.gw + gx]) covered++;
      }
    }
    return cells ? covered / cells : 0;
  }

  function findSignatures(comps, w, h, textMask) {
    // The typical blob on a page of printing IS a character, so the median of
    // every blob on the page is a serviceable stand-in for the type size —
    // no text layer needed, which matters because scans do not have one.
    const glyphH = median(comps.map(c => c.h));
    const glyphW = median(comps.map(c => c.w));
    if (!glyphH || !glyphW) return [];
    const eligible = comps.filter(c =>
      c.h >= glyphH * SIG_GROUP_MIN_HEIGHT_X_GLYPH &&
      c.fill <= SIG_GROUP_MAX_FILL &&
      c.solidity <= SIG_GROUP_MAX_SOLIDITY);
    const out = [];
    for (const c of mergeStrokeGroups(eligible, glyphH)) {
      const aspect = c.w / c.h;
      if (c.h < glyphH * SIG_MIN_HEIGHT_X_GLYPH) continue;
      if (c.w < glyphW * SIG_MIN_WIDTH_X_GLYPH) continue;
      if (aspect < SIG_MIN_ASPECT || aspect > SIG_MAX_ASPECT) continue;
      if (c.w > w * SIG_MAX_PAGE_WIDTH || c.h > h * SIG_MAX_PAGE_HEIGHT) continue;
      if (c.fill > SIG_MAX_FILL) continue;
      if (c.solidity > SIG_MAX_SOLIDITY) continue;
      if (c.ruleRatio > SIG_MAX_RULE_RATIO) continue;
      if (looksLikePrintedWord(c)) continue;
      if (textCoverage(c, textMask) > SIG_MAX_TEXT_COVER) continue;
      // People sign in black or blue. Ink that is mostly warm colour is a
      // logo or a coloured heading — the magenta wordmark in a letterhead is
      // otherwise a near-perfect signature by every measure above.
      if (c.red > c.area * SIG_MAX_WARM_INK && c.red > c.blue) continue;
      // How far past a glyph it is, and how empty it is, are the two things
      // that made it a candidate, so they are also what the confidence says.
      const size = Math.min(1, c.h / (glyphH * 4));
      const sparse = Math.min(1, (SIG_MAX_FILL - c.fill) / SIG_MAX_FILL + 0.3);
      out.push({ kind: 'signature', confidence: Math.min(0.95, 0.45 + 0.3 * size + 0.2 * sparse), box: c });
    }
    return out;
  }

  // ---- company chop ----

  // What makes a chop a chop is its OUTLINE: a stamp is pressed as one
  // continuous frame — a ring, an oval, a rounded rectangle — enclosing its
  // text. In the coloured layer on its own that frame is a single connected
  // component as large as the whole stamp, and nothing else on a business
  // document is. This is the point the seal-detection literature keeps
  // arriving at too (red-layer separation, then connected-component shape),
  // and it is what separates a chop from the thing that otherwise looks
  // identical to a colour detector: a paragraph of red text or a run of blue
  // hyperlinks, which is many character-sized components and no frame at all.
  // Chops here run from a 40-pixel signature seal beside a name to a 185-pixel
  // government seal across a whole signature block, so the floor is low and
  // the work of excluding ring-shaped punctuation — @, ©, a capital O — is
  // done by the glyph-relative floor next to it instead.
  const CHOP_MIN_SIDE = 0.025;      // of the page's long edge
  const CHOP_MIN_SIDE_X_GLYPH = 3.5;
  const CHOP_MAX_SIDE = 0.35;       // the largest real seal here is a seventh of the page
  const CHOP_MIN_ASPECT = 0.30;
  const CHOP_MAX_ASPECT = 3.2;
  const CHOP_MIN_FILL = 0.02;
  const CHOP_MAX_FILL = 0.55;       // above this it is a solid logo, not a stamp
  const CHOP_MAX_SOLIDITY = 0.75;   // above this it is a filled shape, not an outline
  const CHOP_MAX_RULE_RATIO = 0.55; // above this it is a coloured table border
  const CHOP_MIN_HOLE = 0.15;       // of its own bounding box — see largestHoleRatio
  const CHOP_MIN_INSIDE = 0.006;    // coloured wording within the frame

  // The other half of what makes an outline an outline: it encloses paper that
  // cannot be reached from outside without crossing the ink. A signature,
  // however sprawling, never does — you can always walk in from the edge.
  // That topological difference survives a chop being round, oval or
  // rectangular, which no shape ratio does.
  //
  // The paper is flooded 4-connected against 8-connected ink on purpose: the
  // other pairing lets the background escape diagonally through a one-pixel
  // stroke and every ring reads as open.
  function largestHoleRatio(pixels, count, imgW, minX, minY, maxX, maxY) {
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const ink = new Uint8Array(bw * bh);
    for (let k = 0; k < count; k++) {
      const p = pixels[k];
      ink[(((p / imgW) | 0) - minY) * bw + ((p % imgW) - minX)] = 1;
    }
    const seen = new Uint8Array(bw * bh);
    const stack = [];
    for (let x = 0; x < bw; x++) { stack.push(x, (bh - 1) * bw + x); }
    for (let y = 0; y < bh; y++) { stack.push(y * bw, y * bw + bw - 1); }
    while (stack.length) {
      const p = stack.pop();
      if (seen[p] || ink[p]) continue;
      seen[p] = 1;
      const x = p % bw, y = (p / bw) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < bw - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - bw);
      if (y < bh - 1) stack.push(p + bw);
    }
    let hole = 0;
    for (let i = 0; i < ink.length; i++) if (!ink[i] && !seen[i]) hole++;
    return hole / (bw * bh);
  }

  // Whether a shape qualifies is asked of the same blob twice, once in each
  // layer, because neither layer alone is enough. The colour layer holds a red
  // chop cleanly even where it is stamped across printed text — the reason
  // seal detectors separate it in the first place — but a photocopy or a grey
  // scan has no colour left in it at all, and there the chop survives only in
  // the dark layer. Whichever layer it comes from, the test is the same.
  function chopFromShape(shape, long, glyphH, colored) {
    const bw = shape.w, bh = shape.h;
    const floor = Math.max(long * CHOP_MIN_SIDE, glyphH * CHOP_MIN_SIDE_X_GLYPH);
    if (Math.min(bw, bh) < floor) return null;                  // a character
    if (Math.max(bw, bh) > long * CHOP_MAX_SIDE) return null;   // a page element
    const aspect = bw / bh;
    if (aspect < CHOP_MIN_ASPECT || aspect > CHOP_MAX_ASPECT) return null;
    if (shape.fill < CHOP_MIN_FILL || shape.fill > CHOP_MAX_FILL) return null;
    if (shape.solidity > CHOP_MAX_SOLIDITY) return null;        // a solid logo
    if (shape.ruleRatio > CHOP_MAX_RULE_RATIO) return null;     // a ruled box
    // Closed outline or nothing. Without this, one long stroke of a signature
    // passes every other test here and is reported as a chop.
    if (shape.hole < CHOP_MIN_HOLE) return null;
    const chopColored = shape.red + shape.blue >= shape.area * 0.5;
    // In the colour layer everything is coloured by construction; in the dark
    // layer, colour is what raises a plausible ring to a confident one.
    if (colored && !chopColored) return null;
    const round = 1 - Math.min(1, Math.abs(1 - aspect));
    return {
      kind: 'chop',
      color: chopColored ? (shape.red >= shape.blue ? 'red' : 'blue') : null,
      confidence: Math.min(0.95, 0.35 + 0.25 * round + 0.2 * Math.min(1, shape.hole / 0.4) +
        (chopColored ? 0.15 : 0)),
      box: shape,
    };
  }

  function findChops(comps, color, hue, w, h, glyphH, minRun) {
    const long = Math.max(w, h);
    const out = [];
    for (const shape of comps) {
      const mark = chopFromShape(shape, long, glyphH, false);
      if (mark) out.push(mark);
    }
    forEachComponent(color, w, h, INK_MIN_COMPONENT, (pixels, count, minX, minY, maxX, maxY) => {
      const shape = componentShape(pixels, count, minX, minY, maxX, maxY, color, w, h, hue, minRun);
      const mark = chopFromShape(shape, long, glyphH, true);
      if (mark) out.push(mark);
    });
    return out;
  }

  function overlaps(a, b) {
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (x * y) / Math.min(a.w * a.h, b.w * b.h);
  }

  // One chop found in both layers is one chop. Across kinds the bar is much
  // higher, because a chop stamped over a signature is the normal way of
  // signing a contract here — the two overlap by design, and collapsing them
  // would answer "is it chopped" at the cost of "is it signed". Only when the
  // two findings are the same object does the chop win, that being the more
  // specific of the two claims.
  const SAME_MARK_OVERLAP = 0.5;
  const SAME_OBJECT_OVERLAP = 0.85;

  function dedupeMarks(marks) {
    const kept = [];
    for (const m of marks.slice().sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'chop' ? -1 : 1) || b.confidence - a.confidence)) {
      const limit = k => (k.kind === m.kind ? SAME_MARK_OVERLAP : SAME_OBJECT_OVERLAP);
      if (kept.some(k => overlaps(k.box, m.box) > limit(k))) continue;
      kept.push(m);
    }
    return kept;
  }

  // A page with a hundred "signatures" on it has not been signed a hundred
  // times — it is a diagram, a map or a photograph, and the detector has no
  // business calling any of it a signature. Reporting nothing is the honest
  // answer there.
  const MAX_MARKS_PER_PAGE = 6;

  function analyzeInkImage(imageData, options) {
    const w = imageData.width, h = imageData.height;
    const { ink, color, hue } = inkMasks(imageData.data, w, h);
    // The shortest run of ink that is allowed to count as a ruled line. Tied
    // to the raster so it means the same thing at any render size.
    const minRun = Math.max(12, Math.round(Math.max(w, h) / 40));
    const comps = [];
    forEachComponent(ink, w, h, INK_MIN_COMPONENT, (pixels, count, minX, minY, maxX, maxY) => {
      comps.push(componentShape(pixels, count, minX, minY, maxX, maxY, ink, w, h, hue, minRun));
    });
    const glyphH = median(comps.map(c => c.h));
    const textMask = (options && options.textBoxes) ? buildTextMask(options.textBoxes, w, h) : null;
    const found = dedupeMarks(
      findSignatures(comps, w, h, textMask).concat(findChops(comps, color, hue, w, h, glyphH, minRun)));
    const signatures = found.filter(m => m.kind === 'signature');
    const usable = signatures.length > MAX_MARKS_PER_PAGE
      ? found.filter(m => m.kind !== 'signature')
      : found;
    const debug = !!(options && options.debug);
    const marks = usable
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_MARKS_PER_PAGE)
      .map(m => ({
        kind: m.kind,
        shape: debug ? m.box : undefined,
        glyphH: debug ? glyphH : undefined,
        confidence: Math.round(m.confidence * 100) / 100,
        color: m.color || null,
        // Fractions of the page, so a caller can point at the mark without
        // knowing what resolution it was found at.
        bbox: {
          x: +(m.box.x / w).toFixed(4), y: +(m.box.y / h).toFixed(4),
          w: +(m.box.w / w).toFixed(4), h: +(m.box.h / h).toFixed(4),
        },
      }));
    return options && options.debug ? { marks, components: comps } : { marks };
  }

  // ---- page selection and rendering ----

  // Ink inspection costs a render and a pass over every pixel, per page. Short
  // documents get looked at in full; long ones get the pages that talk about
  // signing plus the last few, because that is where the signing happens.
  const INK_ALL_PAGES_MAX = 8;
  const INK_TAIL_PAGES = 3;
  const INK_BUDGET_MS = 25000;

  const SIGNATURE_BLOCK_RE = /(authoris|authoriz)ed\s+(signature|person)|for\s+and\s+on\s+behalf\s+of|signature\s*(&|and|\/)\s*(company\s*)?(chop|stamp)|company\s+(chop|stamp|seal)|signed\s+(by|for)\b|accepted\s+by|授權簽署|公司蓋章|公司印|簽署|簽名|蓋章|盖章|签署|签名/i;

  function pageTextOf(entry) {
    const parts = [];
    (entry.blocks || []).forEach(b => {
      if (b.type === 'table') b.rows.forEach(r => parts.push(r.join(' ')));
      else parts.push((b.lines || []).join(' '));
    });
    return parts.join('\n');
  }

  function pagesToInspect(pageBlocksList) {
    const eligible = pageBlocksList
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.truncated);
    if (eligible.length <= INK_ALL_PAGES_MAX) return eligible.map(e => e.i);
    const picked = new Set();
    eligible.forEach(({ p, i }) => { if (SIGNATURE_BLOCK_RE.test(pageTextOf(p))) picked.add(i); });
    for (const { i } of eligible.slice(-INK_TAIL_PAGES)) picked.add(i);
    // Keeping the LAST few of an over-long list, for the same reason the tail
    // is included at all: signatures live at the end of a document.
    return Array.from(picked).sort((a, b) => a - b).slice(-INK_ALL_PAGES_MAX);
  }

  function imageDataFromCanvas(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  // ---- chop text: what the chop actually says ----
  //
  // Everything above answers "is there a chop here" from shape and colour
  // alone, on purpose — a chop is not printed text, so text extraction alone
  // would never find it. But shape and colour cannot read a company name, and
  // "chopped" without which company is a weaker finding than a name a
  // reviewer can check against the counterparty on the page. Once a box has
  // been drawn around a chop, reading it is an ordinary OCR problem confined
  // to that box, so the same recognizer the rest of this file already uses
  // for the page is pointed at the crop.
  //
  // This is a best-effort add-on, not a new detector: a chop that fails to
  // OCR (a pale impression, a seal ring with no legible run of characters
  // left inside it) still counts as found, just without a name attached.
  const CHOP_TEXT_PAD = 0.15;      // fraction of the chop's own box, each side
  const CHOP_TEXT_MIN_CROP = 4;    // px; below this OCR has nothing to work with
  const CHOP_TEXT_TARGET_EDGE = 240; // upscale target — a chop is small on the page render

  async function readChopText(canvas, ocr, mark) {
    const w = canvas.width, h = canvas.height;
    const bx = mark.bbox.x * w, by = mark.bbox.y * h;
    const bw = mark.bbox.w * w, bh = mark.bbox.h * h;
    const padX = bw * CHOP_TEXT_PAD, padY = bh * CHOP_TEXT_PAD;
    const x0 = Math.max(0, Math.round(bx - padX)), y0 = Math.max(0, Math.round(by - padY));
    const x1 = Math.min(w, Math.round(bx + bw + padX)), y1 = Math.min(h, Math.round(by + bh + padY));
    const cw = x1 - x0, ch = y1 - y0;
    if (cw < CHOP_TEXT_MIN_CROP || ch < CHOP_TEXT_MIN_CROP) return null;
    const crop = document.createElement('canvas');
    const scale = Math.min(4, Math.max(1, CHOP_TEXT_TARGET_EDGE / Math.max(cw, ch)));
    crop.width = Math.round(cw * scale);
    crop.height = Math.round(ch * scale);
    const ctx = crop.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.drawImage(canvas, x0, y0, cw, ch, 0, 0, crop.width, crop.height);
    try {
      const buf = await dataUrlToArrayBuffer(crop.toDataURL('image/png'));
      const { results } = await ocr.recognize(buf, { flatten: true });
      const text = (results || []).map(r => (r.text || '').trim()).filter(Boolean).join(' ').trim();
      return text || null;
    } catch (e) {
      // A crop OCR failure says nothing about whether the chop is real —
      // the shape/colour finding above already answered that — so it is
      // swallowed here rather than turned into a failed page.
      return null;
    }
  }

  // `marks` is mutated in place: `text` is added to each chop mark that
  // yielded something legible, `null` on kinds this does not apply to or
  // where OCR found nothing. Runs after the shape/colour pass, once per page,
  // and only for the (at most MAX_MARKS_PER_PAGE) marks that survived it —
  // never over the whole page, which is what the OCR pass elsewhere is for.
  async function attachChopText(canvas, marks, notify) {
    const chops = (marks || []).filter(m => m.kind === 'chop');
    if (!chops.length || typeof global.PpuPaddleOcr === 'undefined') return;
    let ocr;
    try {
      ocr = await getPaddleOcr(notify);
    } catch (e) {
      return; // no OCR available — chops still stand, just without a name
    }
    for (const mark of chops) {
      mark.text = await readChopText(canvas, ocr, mark);
    }
  }

  // ---- which party a mark belongs to ----
  //
  // A chop's own wording looks like the obvious place to read a company name
  // off, and is the wrong one. The chops on this corpus are round: the name
  // runs around the ring, and a line-based recognizer reads an arc as nothing.
  // Measured over four signed documents, readChopText returned "0", null and
  // "One Center"; the one result that looked like a company name --
  // "on ehalf A uthority-WHSI" -- was the PRINTED sign-off line caught inside
  // its own 15% padding, not the chop.
  //
  // What is legible is exactly that printed line. A signed page names its
  // parties in type, above the ink, one per column:
  //
  //     Yours sincerely                          For and on behalf of
  //     Hong Kong Telecommunications (HKT) Ltd   Hospital Authority - TWGHS
  //          [signature]   [chop]                        [chop]
  //     Chan                                     Customer's Signature & Chop
  //
  // so the party a mark belongs to is the company introduced by the nearest
  // sign-off cue standing above it in its own column. That is what this reads,
  // and it is the only thing that works for a signature at all -- handwriting
  // carries no company name to recognize.
  //
  // Off by default. `pages` is part of parseFile's result, so a mark growing a
  // `context` property is a visible output change and Docparse/index.html's
  // two-argument call must not see one. Opt in with `markContext: true`.
  //
  // Deliberately silent rather than approximate: a mark with no sign-off cue
  // above it gets no context, instead of the nearest company-shaped words.

  // Anchored at the start of a line: these introduce the party, and a mention
  // of "on behalf of" mid-sentence in a clause does not.
  const SIGNOFF_CUE_RE = /^\s*(?:signed\s+)?(?:for\s+and\s+)?on\s+behalf\s+of\b|^\s*(?:signed\s+)?for\s+and\s+on\s+behalf\b|^\s*yours\s+(?:sincerely|faithfully|truly)\b|^\s*(?:代表|謹啟|谨启)/i;
  // What the ruled line under the ink is called. Read as a description of the
  // mark, never as the name of a party.
  const SIGNOFF_LABEL_RE = /(?:authoris|authoriz)ed\s+(?:signature|person)|signature\s*(?:&|and|\/)\s*(?:company\s*)?(?:chop|stamp)|company\s+(?:chop|stamp|seal)|(?:client|customer)'?s?\s+signature|accepted\s+by|^\s*date\s*[:：]?\s*$/i;
  // How far above a mark its own sign-off block may stand, as a fraction of
  // the page. Wide enough for a signature that sprawls well below the name it
  // belongs to; narrow enough that the block above it is not eligible.
  const CONTEXT_MAX_ABOVE = 0.14;
  const CONTEXT_MAX_BELOW = 0.10;
  // How far above the company name its own cue may stand. A cue and the name
  // it introduces are consecutive lines; anything further up is a different
  // part of the page.
  const CONTEXT_MAX_CUE_GAP = 0.035;
  // Same column: the ink has to sit under the name, not merely on the same
  // band of the page. This is the whole of what separates the two columns of
  // a signed page, so it is measured against the mark's own width -- a chop is
  // narrower than the line naming its owner, never the other way round.
  const CONTEXT_MIN_COLUMN_OVERLAP = 0.35;

  // A two-column sign-off puts both parties on the SAME baseline: "Yours
  // sincerely" and "For and on behalf of" are one line by every vertical
  // measure, and joined into one they span the page and make the column test
  // meaningless -- which is exactly how the left party's name ends up over the
  // right party's chop. So a line is cut wherever the horizontal gap is far
  // wider than the spaces inside it. Measured against the line's own height so
  // it means the same thing at any render size, with a floor for the OCR case
  // where a whole line arrives as one box and the height is a poor proxy.
  const COLUMN_GAP_X_HEIGHT = 2.5;
  const COLUMN_GAP_MIN = 0.025;   // of the page width

  function splitLineAtColumnGaps(parts, h) {
    const sorted = parts.slice().sort((p, q) => p.x - q.x);
    const limit = Math.max(h * COLUMN_GAP_X_HEIGHT, COLUMN_GAP_MIN);
    const runs = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = runs[runs.length - 1];
      const right = Math.max.apply(null, prev.map(p => p.x + p.w));
      if (sorted[i].x - right > limit) runs.push([sorted[i]]);
      else prev.push(sorted[i]);
    }
    return runs;
  }

  // Boxes arrive in reading order but not grouped into lines. Two boxes share a
  // line when their vertical spans overlap by more than half the shorter one --
  // proportional rather than a fixed tolerance, so it holds at any render size
  // and for the larger type a sign-off block sets the company name in.
  function boxesToLines(boxes) {
    const lines = [];
    for (const b of boxes.slice().sort((p, q) => p.y - q.y || p.x - q.x)) {
      const line = lines.find(l => {
        const top = Math.max(l.y, b.y), bottom = Math.min(l.y + l.h, b.y + b.h);
        return (bottom - top) > Math.min(l.h, b.h) * 0.5;
      });
      if (line) {
        const bottom = Math.max(line.y + line.h, b.y + b.h);
        line.y = Math.min(line.y, b.y);
        line.h = bottom - line.y;
        line.x = Math.min(line.x, b.x);
        line.right = Math.max(line.right, b.x + b.w);
        line.parts.push(b);
      } else {
        lines.push({ x: b.x, right: b.x + b.w, y: b.y, h: b.h, parts: [b] });
      }
    }
    const out = [];
    for (const l of lines) {
      for (const run of splitLineAtColumnGaps(l.parts, l.h)) {
        out.push({
          x: Math.min.apply(null, run.map(p => p.x)),
          right: Math.max.apply(null, run.map(p => p.x + p.w)),
          y: Math.min.apply(null, run.map(p => p.y)),
          h: Math.max.apply(null, run.map(p => p.y + p.h)) - Math.min.apply(null, run.map(p => p.y)),
          text: run.map(p => String(p.text == null ? '' : p.text)).join(' ')
            .replace(/\s+/g, ' ').trim(),
        });
      }
    }
    return out.filter(l => l.text).sort((p, q) => p.y - q.y);
  }

  function sharesColumn(mark, line) {
    const x0 = mark.bbox.x, x1 = mark.bbox.x + mark.bbox.w;
    const overlap = Math.min(x1, line.right) - Math.max(x0, line.x);
    return overlap > 0 && overlap >= (x1 - x0) * CONTEXT_MIN_COLUMN_OVERLAP;
  }

  // Between two lines the comparison is symmetric: a cue ("Yours sincerely")
  // is far shorter than the company name under it, so measuring against the
  // wider of the two would put them in different columns. Against the
  // narrower, a left-aligned pair matches and the other column still does not.
  function linesShareColumn(a, b) {
    const overlap = Math.min(a.right, b.right) - Math.max(a.x, b.x);
    return overlap > 0 &&
           overlap >= Math.min(a.right - a.x, b.right - b.x) * CONTEXT_MIN_COLUMN_OVERLAP;
  }

  // A chop is routinely stamped so that it laps over the line naming its owner
  // -- the purple seal on the corpus's one two-party page overlaps the name
  // above it by a third of its own height. So "above" is measured against the
  // mark's middle, not its top, or that chop finds no owner at all.
  function standsAbove(mark, line) {
    const gap = mark.bbox.y - (line.y + line.h);
    return gap <= CONTEXT_MAX_ABOVE && gap >= -mark.bbox.h * 0.5;
  }

  function namesAParty(line) {
    return !SIGNOFF_CUE_RE.test(line.text) &&
           !SIGNOFF_LABEL_RE.test(line.text) &&
           /[A-Za-z一-鿿]/.test(line.text);
  }

  // The nearest cue line above `line`, in the same column. Returns null when
  // the line directly above is something else — which is the answer that keeps
  // this from naming a party off any wide line that happens to sit over ink.
  function cueAbove(line, lines) {
    let best = null;
    for (const c of lines) {
      const gap = line.y - (c.y + c.h);
      // A small negative gap is still "above": OCR boxes are drawn generously
      // and two consecutive lines routinely overlap by a pixel or two.
      // Measured on the corpus the cue's box ends 0.001 of a page BELOW the
      // top of the name it introduces, which a `gap < 0` test throws away.
      if (gap < -Math.min(line.h, c.h) * 0.6 || gap > CONTEXT_MAX_CUE_GAP) continue;
      if (!linesShareColumn(line, c)) continue;
      if (!best || gap < best.gap) best = { line: c, gap };
    }
    return best && SIGNOFF_CUE_RE.test(best.line.text) ? best.line : null;
  }

  // The search runs name-first, not cue-first. A cue is short ("Yours
  // sincerely" is a fifth of the width of the company under it) and a chop
  // stamped under the company name does not overlap the cue's column at all,
  // so looking for the cue in the mark's own column finds nothing on the very
  // documents this exists for. The company name is the wide line, the mark
  // sits under it, and the cue is then found relative to the NAME.
  function signOffContextFor(mark, lines) {
    const column = lines.filter(l => sharesColumn(mark, l));
    // Nearest first: on a page that signs twice in one column, the block the
    // mark sits in is the one closest above it.
    const above = column.filter(l => standsAbove(mark, l)).reverse();
    for (const line of above) {
      let name = null, cue = null, cueLine = null;
      if (SIGNOFF_CUE_RE.test(line.text)) {
        // "Signed for and on behalf of HONG KONG QUALITY ASSURANCE AGENCY" —
        // cue and party on one line.
        const rest = line.text.replace(SIGNOFF_CUE_RE, '').replace(/^[\s:,\-–—]+/, '').trim();
        if (rest) { name = rest; cue = line.text; cueLine = line; }
      } else if (namesAParty(line)) {
        const found = cueAbove(line, lines);
        if (found) { name = line.text; cue = found.text; cueLine = found; }
      }
      if (!name) continue;
      const below = column
        .filter(l => l.y >= mark.bbox.y + mark.bbox.h * 0.5 &&
                     l.y - (mark.bbox.y + mark.bbox.h) <= CONTEXT_MAX_BELOW &&
                     SIGNOFF_LABEL_RE.test(l.text))
        .shift();
      // `box` is where those lines actually sit, which is the only thing that
      // knows how wide this mark's COLUMN is. markCropRect needs it: a crop
      // sized from the mark alone cannot reach the name (measured: HKT's name
      // starts 0.221 of the page left of its own chop) and one widened
      // symmetrically until it could would take in the counterparty's chop as
      // well, which is exactly the question the crop exists to answer.
      return { name, cue, label: below ? below.text : null,
        box: unionBox([line, cueLine, below]) };
    }
    return null;
  }

  // The smallest box covering all of them, in whatever coordinates they share.
  // Nulls are skipped so callers can pass optional lines positionally.
  //
  // TWO box shapes reach this and both are read rather than one being assumed:
  // boxesToLines emits `{x, right, y, h}` while mark bboxes and text boxes
  // carry `{x, w, y, h}`. Reading only `w` makes every bound NaN for a line,
  // which JSON prints as null and markCropRect then treats as "no context" --
  // a silent fall back to the blind rect that looks exactly like a mark whose
  // owner was never found.
  function unionBox(boxes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes || []) {
      if (!b) continue;
      const right = b.right === undefined ? b.x + b.w : b.right;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, right); y1 = Math.max(y1, b.y + b.h);
    }
    return x0 === Infinity || !isFinite(x1 - x0) || !isFinite(y1 - y0)
      ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---- the sign-off band, when the page-wide read missed it ----
  //
  // Measured on the one scanned two-party page in the corpus: the full-page OCR
  // pass returns NOTHING for the band the sign-off block sits in. Every line
  // above it and below it comes back, and the four lines that name the two
  // parties do not — the ink sitting across that band appears to cost the
  // detector the whole strip. Cropped out on its own and upscaled, the very
  // same recognizer reads all four cleanly ("Yours sincerely", "Hong Kong
  // Telecommunications (HKT) Limited", "For and on behalf of", "Hospital
  // Authority- TWGHS, Int'l Funeral Parlour").
  //
  // So this is a second, targeted read — one crop per page, not per mark, and
  // only for a page that has marks nobody could name from what the page-wide
  // pass already produced. Full page WIDTH, because which column a name is in
  // is the whole question; only the vertical extent is narrowed.
  //
  // The band is read at OCR resolution, NOT at the ink pass's. The ink render
  // is deliberately coarse (INK_LONG_EDGE) — enough to find a blob of ink, not
  // enough to read 9pt type off — and upscaling it adds no detail that was
  // never captured. A PDF page is simply rendered again for the band; an image
  // has only the pixels it arrived with, so there the ink canvas is all there
  // is, and this is best-effort.
  const BAND_TARGET_WIDTH = 1600;
  // How tall the strip may be, as a fraction of the page — and this is a
  // recognition threshold, not a cost one. Measured on the same page at the
  // same resolution: a 0.20 strip comes back as "Hong Kong Telecommunications
  // (HKT) Limited", a 0.35 strip as "Hong Kon Telecomunictin HT Li e Y". The
  // recognizer resizes what it is handed, and a taller image spends that
  // budget on height instead of on legible characters. Doubling the render
  // resolution recovers most of it, at four times the pixels; keeping the
  // strip short is the cheaper half of the same trade.
  const BAND_MAX_HEIGHT = 0.20;

  // Only the space ABOVE the ink is worth re-reading: that is where the
  // sign-off cue and the company name are. Reaching below the mark for the
  // ruled line's label would push the strip past the height above for no gain
  // — on a scanned page `label` is simply left unanswered.
  function signOffBandFor(marks) {
    let top = 1, bottom = 0;
    for (const m of marks) {
      top = Math.min(top, m.bbox.y - CONTEXT_MAX_ABOVE);
      // Half-way down the mark, not its top: a chop routinely laps over the
      // name it belongs to, and a strip that stops at the chop's top edge cuts
      // that name in half. See standsAbove, which allows the same overlap.
      bottom = Math.max(bottom, m.bbox.y + m.bbox.h * 0.5);
    }
    top = Math.max(0, top);
    bottom = Math.min(1, bottom, top + BAND_MAX_HEIGHT);
    return bottom - top > 0.02 ? { top, bottom } : null;
  }

  // The band of one PDF page, rendered on its own at reading resolution.
  // pdf.js draws a sub-region by offsetting the viewport, so this costs a strip
  // rather than another whole page.
  function renderPdfBand(page, rotation, band) {
    const scale = ocrRenderScale(page);
    const full = page.getViewport({ scale, rotation: (page.rotate || 0) + rotation });
    const y0 = Math.round(band.top * full.height);
    const y1 = Math.round(band.bottom * full.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(full.width);
    canvas.height = Math.max(1, y1 - y0);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return page.render({ canvasContext: ctx, viewport: full.clone({ offsetY: -y0 }) })
      .promise.then(() => canvas);
  }

  // The same band cut out of an already-rendered canvas. All an image page has.
  function cropBand(source, band) {
    const y0 = Math.round(band.top * source.height);
    const y1 = Math.round(band.bottom * source.height);
    const scale = Math.min(4, Math.max(1, BAND_TARGET_WIDTH / source.width));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.max(1, Math.round((y1 - y0) * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, y0, source.width, y1 - y0, 0, 0, canvas.width, canvas.height);
    return Promise.resolve(canvas);
  }

  async function readSignOffBand(canvas, ocr, band) {
    const buf = await dataUrlToArrayBuffer(canvas.toDataURL('image/png'));
    const { results } = await ocr.recognize(buf, { flatten: true });
    const span = band.bottom - band.top;
    return (results || [])
      .filter(r => r.text && r.text.trim() && r.box)
      .map(r => ({
        x: r.box.x / canvas.width,
        w: r.box.width / canvas.width,
        // Back out of the band's own pixels into fractions of the whole page,
        // which is the only space marks and boxes are ever compared in.
        y: band.top + (r.box.y / canvas.height) * span,
        h: (r.box.height / canvas.height) * span,
        text: r.text.trim(),
      }));
  }

  // Runs only for marks still unnamed after the ordinary boxes were tried, and
  // is swallowed on failure for the same reason attachChopText is: not knowing
  // whose chop it is does not make the chop less found.
  async function attachContextFromBand(marks, notify, renderBand) {
    const unnamed = (marks || []).filter(m => !m.context);
    if (!unnamed.length || typeof global.PpuPaddleOcr === 'undefined') return;
    const band = signOffBandFor(unnamed);
    if (!band) return;
    try {
      const ocr = await getPaddleOcr(notify);
      attachMarkContext(unnamed, await readSignOffBand(await renderBand(band), ocr, band));
    } catch (e) {
      // no OCR, or the render failed — the marks stand, just unattributed
    }
  }

  // `marks` is mutated in place, the same way attachChopText does. Marks with
  // no sign-off block above them are left untouched rather than given a null
  // context -- absent and "looked, found nothing" are the same answer here,
  // and an absent property keeps the mark shape unchanged for every caller
  // that did not ask for context.
  // ---- the per-mark crop: "show me THAT chop" without opening the document ----
  //
  // What a reviewer is asking of a chop is whose it is, and the answer is never
  // in the ink: measured across all four documents in `Demo Data/chop/`,
  // readChopText returned "0", null, "One Center" and "lons (HK1) Limited 6".
  // The chops are round, and a line recognizer reads an arc as nothing. What IS
  // legible is the printed sign-off block above the ink, so the crop has to
  // carry it — a picture of the seal alone shows the reviewer the one part of
  // the page that cannot be checked.
  //
  // Hence the rect is the UNION of the mark and the lines mark.context was read
  // from, not a padding factor on the mark. On the real two-column page:
  //
  //   HKT chop      x 0.321..0.431   its name line  x 0.100..0.414
  //   customer chop x 0.626..0.752
  //
  // The name starts 0.221 of the page LEFT of the chop that owns it, so a
  // symmetric pad wide enough to include it reaches 0.662 and takes in the
  // counterparty's seal — turning a "whose is this" answer back into the
  // two-answer question it started as.
  const CROP_MARGIN = 0.02;          // fraction of the page, each side
  const CROP_TARGET_EDGE = 480;      // px on the long edge; 9pt type stays legible
  const CROP_MIN_PX = 8;             // below this there is nothing to show
  const CROP_QUALITY = 0.75;

  // Pure geometry over page fractions, so it is testable without a canvas --
  // same reason attachMarkContext takes normalised boxes. Returns fractions.
  function markCropRect(mark) {
    const b = mark && mark.bbox;
    if (!b) return null;
    const ctx = mark.context && mark.context.box;
    // With no context the column is unknown, so this is best effort: reach up
    // by the same CONTEXT_MAX_ABOVE the owner search uses, and widen only
    // modestly. Guessing a column here would be worse than a tight crop -- a
    // wrong column shows the other party's block under this mark's name.
    const box = ctx ? unionBox([b, ctx])
      : { x: b.x - b.w * 0.5, y: b.y - CONTEXT_MAX_ABOVE,
          w: b.w * 2, h: b.h + CONTEXT_MAX_ABOVE };
    const x0 = Math.max(0, box.x - CROP_MARGIN);
    const y0 = Math.max(0, box.y - CROP_MARGIN);
    const x1 = Math.min(1, box.x + box.w + CROP_MARGIN);
    const y1 = Math.min(1, box.y + box.h + CROP_MARGIN);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // Stamps `mark.crop` (a data URL) on every mark that has a rect worth
  // drawing. Opt-in via `markCrop: true` for the same reason markContext is:
  // `pages` is part of parseFile's result, so a mark growing a property is a
  // visible output change and Docparse/index.html's two-argument call must not
  // see one. Runs AFTER the context passes, because the rect is read off
  // mark.context.box.
  function attachMarkCrops(canvas, marks) {
    const w = canvas.width, h = canvas.height;
    for (const mark of marks || []) {
      const r = markCropRect(mark);
      if (!r) continue;
      const sx = Math.round(r.x * w), sy = Math.round(r.y * h);
      const sw = Math.round(r.w * w), sh = Math.round(r.h * h);
      if (sw < CROP_MIN_PX || sh < CROP_MIN_PX) continue;
      const out = document.createElement('canvas');
      // Downscale only. A crop is already at ink-pass resolution; upscaling
      // adds no detail that was never captured, only bytes.
      const scale = Math.min(1, CROP_TARGET_EDGE / Math.max(sw, sh));
      out.width = Math.max(1, Math.round(sw * scale));
      out.height = Math.max(1, Math.round(sh * scale));
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      try {
        mark.crop = out.toDataURL('image/jpeg', CROP_QUALITY);
      } catch (err) {
        // A tainted canvas or an out-of-memory encode leaves the mark without a
        // picture; it still counts as found and still names its owner.
      }
    }
  }

  function attachMarkContext(marks, boxes) {
    if (!marks || !marks.length || !boxes || !boxes.length) return;
    const lines = boxesToLines(boxes);
    if (!lines.length) return;
    for (const mark of marks) {
      const context = signOffContextFor(mark, lines);
      if (context) mark.context = context;
    }
  }

  // Where the page's typed characters sit, in the pixels of this render.
  // Sized from the text item's own transform rather than assumed, so italics
  // and small print are boxed as tightly as body text.
  function textBoxesFor(textContent, viewport, scale) {
    const boxes = [];
    for (const it of (textContent && textContent.items) || []) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      const point = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      const fontSize = Math.hypot(it.transform[2], it.transform[3]) * scale ||
                       Math.abs(it.transform[3]) * scale || 10;
      const width = (it.width || 0) * scale;
      if (!width) continue;
      // `text` is carried for attachMarkContext, which needs to know what the
      // type near a mark SAYS. buildTextMask, the other reader, only ever looks
      // at the geometry and is unaffected by the extra property.
      boxes.push({ x: point[0], y: point[1] - fontSize, w: width, h: fontSize * 1.3, text: it.str });
    }
    return boxes;
  }

  // Mark bboxes are fractions of the page; text boxes are pixels of whichever
  // render they were measured in. Fractions are the only coordinates the ink
  // render and the OCR render of one page share, so the conversion happens
  // once, here, rather than at every comparison.
  function boxesAsPageFractions(boxes, width, height) {
    if (!boxes || !boxes.length || !width || !height) return null;
    return boxes.map(b => ({
      x: b.x / width, y: b.y / height, w: b.w / width, h: b.h / height, text: b.text,
    }));
  }

  // `opts` (optional) carries `markContext` and, for a page that was read by
  // OCR rather than from a text layer, the `ocrBoxes` that read produced --
  // already in page fractions. A scanned page has no text layer to name its
  // parties from, so without those boxes it gets no context.
  async function inspectPdfPage(page, rotation, useTextLayer, notify, opts) {
    const scale = ocrRenderScale(page, INK_LONG_EDGE);
    const viewport = page.getViewport({ scale, rotation: (page.rotate || 0) + rotation });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    // Explicit white, not the canvas default of transparent black: the alpha
    // compositing in inkMasks handles it either way, but a real background
    // keeps a page with a white-filled rectangle on it from reading as ink.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const textBoxes = useTextLayer
      ? textBoxesFor(await page.getTextContent(), viewport, scale)
      : null;
    const marks = analyzeInkImage(imageDataFromCanvas(canvas), { textBoxes }).marks;
    await attachChopText(canvas, marks, notify);
    if (opts && opts.markContext) {
      attachMarkContext(marks, (opts.ocrBoxes && opts.ocrBoxes.length)
        ? opts.ocrBoxes
        : boxesAsPageFractions(textBoxes, canvas.width, canvas.height));
      await attachContextFromBand(marks, notify, band => renderPdfBand(page, rotation, band));
    }
    // Last, so the rect can be read off the context both passes above attach.
    if (opts && opts.markCrop) attachMarkCrops(canvas, marks);
    return marks;
  }

  function inspectDataUrl(dataUrl, rotation, notify, opts) {
    return rotateDataUrl(dataUrl, rotation, INK_LONG_EDGE).then(url => new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const marks = analyzeInkImage(imageDataFromCanvas(canvas)).marks;
        await attachChopText(canvas, marks, notify);
        if (opts && opts.markContext) {
          attachMarkContext(marks, opts.ocrBoxes);
          await attachContextFromBand(marks, notify, band => cropBand(canvas, band));
        }
        if (opts && opts.markCrop) attachMarkCrops(canvas, marks);
        resolve(marks);
      };
      // A page we cannot render is a page we cannot judge; an empty mark list
      // would claim we looked and found nothing.
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }

  // Marks are attached to the page entries in place. A page that was inspected
  // and had nothing on it gets [] — the difference between that and undefined
  // is the difference between "not signed" and "not checked", and the caller
  // reports them differently.
  // Which page to spend the budget on first. Some templates take seconds per
  // page to rasterise, so the budget can run out part-way through a document
  // that is well under the page limit — and inspecting front to back spends it
  // on exactly the wrong pages, since a page that talks about signing is the
  // likeliest to carry one and signatures otherwise live at the end.
  // Order within a rank is left alone — the sort is stable, so pages that
  // mention signing are still looked at in the order they appear. Preferring
  // later pages inside that group would push a first-page signature behind
  // twenty pages of contract boilerplate that also says "signature".
  function inspectionOrder(pageBlocksList, wanted) {
    const rank = idx => (SIGNATURE_BLOCK_RE.test(pageTextOf(pageBlocksList[idx])) ? 0 : 1);
    return wanted.slice().sort((a, b) => rank(a) - rank(b));
  }

  // `deadline`, when given, is the same soft OCR deadline processPdf's page
  // loop was bounded by — the absolute timestamp the surrounding attachment's
  // hard timeout is measured from (deadline + ATTACHMENT_HARD_BUFFER_MS). The
  // OCR loop can already overrun `deadline` by up to one page's worth of work
  // before this runs, so the ink pass's own budget is capped against whatever
  // of that hard-timeout buffer is left, not spent as if the buffer were still
  // whole. Without this, a slow scan that used most of the buffer already gets
  // an unconditional 25s more piled on top, which can cross the hard timeout
  // and throw away every page this same pass exists to finish reading.
  async function inspectPagesForMarks(pdfDoc, pageBlocksList, notify, rotation, budgetMs, deadline, markContext, markCrop) {
    const wanted = pagesToInspect(pageBlocksList);
    if (!wanted.length) return;
    let stopAt = Date.now() + (budgetMs || INK_BUDGET_MS);
    if (deadline) {
      // 5s safety margin so the loop itself yields control before the hard
      // timeout's own setTimeout fires and rejects the whole attachment.
      const hardStopAt = deadline + ATTACHMENT_HARD_BUFFER_MS - 5000;
      stopAt = Math.min(stopAt, hardStopAt);
    }
    for (const idx of inspectionOrder(pageBlocksList, wanted)) {
      if (Date.now() > stopAt) break;
      const entry = pageBlocksList[idx];
      notify(`Checking page ${entry.pageNum} for a signature or company chop…`);
      try {
        // A page that needed OCR has no trustworthy text layer to subtract:
        // whatever pdf.js found there was too thin to read from, and OCR's own
        // boxes routinely land on the signature itself. A deferred page is that
        // same page before anyone read it, so it has to be treated the same way
        // — otherwise the light pass measures ink differently from an eager
        // parse of the identical document, and resumeDeferredOcr then carries
        // those mismatched marks forward as seedMarks.
        entry.marks = await inspectPdfPage(
          await pdfDoc.getPage(entry.pageNum), rotation, !entry.ocr && !entry.ocrPending, notify,
          (markContext || markCrop)
            ? { markContext: markContext, markCrop: markCrop, ocrBoxes: entry.ocrBoxes }
            : undefined);
      } catch (err) {
        // Leave marks undefined: this page went unchecked, and saying so is
        // better than reporting a clean page we never managed to look at.
      }
      await yieldToUi();
    }
  }

  // ---------- ATQ workbook: "Cost" sheet lists one row per purchased item;
  // "ATQ" sheet is a single vertical label/value record (col A = label, col
  // B = value) with info shared by every item on that workbook. Detected by
  // filename prefix + both sheets actually present, so it only engages for
  // this specific template and every other Excel/CSV keeps its existing
  // plain CSV-dump behavior. ----------
  function isAtqWorkbookFile(fileName) {
    return /^ATQ/i.test(fileName) && /\.xlsx?$/i.test(fileName);
  }

  function normalizeHeader(s) {
    return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // col A -> normalized-lowercase label, col B -> value. Keeps the first
  // occurrence of a repeated label (e.g. "Customer Number" appears twice).
  function parseAtqLabelMap(sheet) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const map = new Map();
    for (const row of rows) {
      const label = normalizeHeader(row[0]).toLowerCase();
      if (!label || map.has(label)) continue;
      map.set(label, String(row[1] == null ? '' : row[1]).trim());
    }
    return map;
  }

  function atqField(map, ...labels) {
    for (const l of labels) {
      const v = map.get(l);
      if (v) return v;
    }
    return '';
  }

  // One item per data row whose "ATQ Ref. No." cell is non-empty (skips
  // blank/subtotal rows without guessing where the table ends). Columns are
  // matched with the same vocabulary the PDF print uses (ATQ_COST_COLUMNS),
  // so both readers of this table cover the same eleven columns: the earlier
  // exact-string map read five of them, which is how a workbook record ended
  // up looking poorer than the PDF record of the very same row.
  function parseCostItems(sheet) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    if (!rows.length) return [];
    const colIndex = {};
    rows[0].forEach((h, i) => {
      const folded = foldHeader(normalizeHeader(h));
      if (!folded) return;
      const hit = ATQ_COST_COLUMNS.find(([re]) => re.test(folded));
      // First column wins a given name, matching atqCostColumnMap. (colIndex
      // is keyed by name here, so the "already taken" test is on keys.)
      if (hit && !Object.prototype.hasOwnProperty.call(colIndex, hit[1])) colIndex[hit[1]] = i;
    });
    const items = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const atqRefNo = colIndex.atqRefNo != null ? String(row[colIndex.atqRefNo] || '').trim() : '';
      if (!atqRefNo) continue;
      const item = {};
      Object.keys(colIndex).forEach(key => {
        item[key] = String(row[colIndex[key]] == null ? '' : row[colIndex[key]]).trim();
      });
      items.push(item);
    }
    return items;
  }

  // Returns one record per Cost-sheet item, each carrying its own item
  // values plus the ATQ-sheet-wide values merged in. Returns null when the
  // workbook doesn't have this shape, so callers fall back cleanly.
  function parseAtqWorkbook(wb) {
    const costSheet = wb.Sheets['Cost'];
    const atqSheet = wb.Sheets['ATQ'];
    if (!costSheet || !atqSheet) return null;

    const items = parseCostItems(costSheet);
    if (!items.length) return null;

    const atqMap = parseAtqLabelMap(atqSheet);
    const wide = {
      customerName: atqField(atqMap, 'customer name'),
      projectDescription: atqField(atqMap, 'project description'),
      agreementNumber: atqField(atqMap, 'agreement number_new', 'agreement number'),
      contractStartDate: atqField(atqMap, '(min)contract start date_new'),
      contractEndDate: atqField(atqMap, '(max)contract end date_new'),
      creater: atqField(atqMap, 'creater'),
    };

    // Labels match atqRecordsFromTables' exactly, so a consumer cannot tell
    // which of the two produced a record — and so dedupeAtqRecords can compare
    // them field for field.
    return items.map(item => ({
      fields: [
        { label: 'ATQ Ref. No.', value: item.atqRefNo || '' },
        { label: 'Item No.', value: item.itemNo || '' },
        { label: 'Product Type', value: item.productType || '' },
        { label: 'Service Type', value: item.serviceType || '' },
        { label: 'Vendor / Distributor', value: item.vendor || '' },
        { label: 'Back-to-Back (Y/N)', value: item.backToBack || '' },
        { label: 'Total Value of Quotation (HKD)', value: item.totalValueOfQuotation || '' },
        { label: 'Quotation', value: item.quotation || '' },
        { label: 'Remark', value: item.remark || '' },
        { label: 'Customer Name', value: wide.customerName },
        { label: 'Project Description', value: wide.projectDescription },
        { label: 'Agreement Number', value: wide.agreementNumber },
        { label: '(Min)Contract Start Date', value: wide.contractStartDate },
        { label: '(Max)Contract End Date', value: wide.contractEndDate },
        { label: 'Creater', value: wide.creater },
      ],
      // The reference of this item's quotation/agreement document, which in an
      // email arrives as a separate attachment named after it. Resolved to
      // actual filenames by matchQuotationAttachments() once the whole
      // attachment list is known; on its own (a bare .xlsx) it stays a plain
      // reference with nothing to match against.
      quotationRef: item.quotation || '',
    }));
  }

  // ---------- ATQ cost table read out of a PDF of the form ----------
  //
  // The same form arrives both ways: as the workbook it was exported from and
  // as a PDF print of it. parseAtqWorkbook already turns the workbook's Cost
  // sheet into one record per purchased item; this produces the identical
  // shape from the printed table, so everything downstream — the per-item
  // tabs, the quotation-to-attachment matching — works without caring which
  // one the email happened to carry.
  //
  // Columns are identified by their own headers rather than by position: the
  // header spans three physical rows in the print, and which of them a word
  // lands on varies with how long the text above it ran.
  const ATQ_COST_COLUMNS = [
    // Only the workbook prints this column; no PDF header folds to "atqref…",
    // and atqRecordsFromTables does not read atqRefNo, so its presence here is
    // inert for the PDF path.
    [/^atqref/, 'atqRefNo'],
    // Anchored at either end, not just the start. The header rows are folded
    // top to bottom, so anything that leaked in from a line above lands as a
    // *prefix*: one ATQ prints "Total Direct Variable Cost with HKT (HKD):" on
    // the same physical line as the header's first row, which glued that whole
    // sentence in front of "ITEM NO." and cost the table its itemNo column —
    // and with it, via the four-key guard below, every item on the form.
    [/^itemno|itemno$/, 'itemNo'],
    [/^workorder/, 'workOrderNo'],
    [/producttype/, 'productType'],
    [/servicetype/, 'serviceType'],
    [/vendor|distributor/, 'vendor'],
    [/backtoback/, 'backToBack'],
    [/contactperson/, 'customerContact'],
    [/totalvalue.*hkd|quotationhkd/, 'totalValueOfQuotation'],
    [/^quotation$/, 'quotation'],
    [/remark/, 'remark'],
  ];

  const ATQ_ITEM_NO_RE = /^\d{1,3}$/;

  function foldHeader(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Column index -> field name, from however many header rows precede the
  // first numbered item.
  function atqCostColumnMap(rows, firstDataRow) {
    const width = Math.max(...rows.map(r => r.length));
    const map = {};
    for (let c = 0; c < width; c++) {
      const header = foldHeader(rows.slice(0, firstDataRow).map(r => tableCell(r, c)).join(' '));
      if (!header) continue;
      const hit = ATQ_COST_COLUMNS.find(([re]) => re.test(header));
      if (hit && !Object.values(map).includes(hit[1])) map[c] = hit[1];
    }
    return map;
  }

  // A reference is one unbroken token; the spaces in "0000Ht601 164892026
  // 06300008" are where the column wrapped it, not part of what it says. Only
  // spaces between alphanumeric runs are closed up — anything else stays.
  function joinWrappedReference(value) {
    return /^[A-Za-z0-9]+(\s+[A-Za-z0-9]+)+$/.test(value) ? value.replace(/\s+/g, '') : value;
  }

  // A printed item can span several physical rows: each column wraps on its
  // own, so the row carrying the item number holds only the first line of every
  // cell and the rows beneath it hold the rest. Nothing but the empty item
  // number marks them as continuations.
  //
  // They are not always joined with a space. Checked against the workbook the
  // same ATQ was exported from — the only ground truth available — three shapes
  // occur across the corpus: a reference followed by a descriptor, where the
  // wrap falls on the space before the dash; a descriptor broken mid-token,
  // where the first line ends on the dash itself; and a list of work orders
  // that wraps with its comma leading. Suppressing the space wherever the break
  // already carries punctuation reproduces all three verbatim.
  function joinWrappedCell(left, right) {
    if (!left) return right;
    if (!right) return left;
    if (/-$/.test(left) || /^[,.;:)]/.test(right)) return left + right;
    return left + ' ' + right;
  }

  function parseAtqCostTable(rows) {
    const body = dataRows(rows || []);
    const firstDataRow = body.findIndex(r => ATQ_ITEM_NO_RE.test(tableCell(r, 0)));
    if (firstDataRow < 1) return null;
    const map = atqCostColumnMap(body, firstDataRow);
    const named = Object.values(map);
    // Without these four the table is not the cost table, whatever else it is.
    if (!['itemNo', 'productType', 'vendor', 'totalValueOfQuotation']
      .every(k => named.includes(k))) return null;

    const items = [];
    for (let r = firstDataRow; r < body.length; r++) {
      if (!ATQ_ITEM_NO_RE.test(tableCell(body[r], 0))) continue;   // a subtotal or stray row
      const item = {};
      Object.keys(map).forEach(c => { item[map[c]] = tableCell(body[r], c); });
      // Everything down to the next item number belongs to this item. A row
      // that is neither an item nor a continuation — a subtotal printed inside
      // the table — would be absorbed here rather than skipped; no ATQ in the
      // corpus prints one, and reading a real wrapped value is worth the risk
      // of one day appending a total to it.
      for (let k = r + 1; k < body.length && !ATQ_ITEM_NO_RE.test(tableCell(body[k], 0)); k++) {
        Object.keys(map).forEach(c => {
          item[map[c]] = joinWrappedCell(item[map[c]], tableCell(body[k], c));
        });
      }
      if (item.quotation) item.quotation = joinWrappedReference(item.quotation);
      items.push(item);
    }
    return items.length ? items : null;
  }

  // Same record shape parseAtqWorkbook returns, so the two paths are
  // interchangeable to every consumer.
  function atqRecordsFromTables(tables, fields) {
    let items = null;
    for (const rows of tables) {
      items = parseAtqCostTable(rows);
      if (items) break;
    }
    if (!items) return null;

    const wide = label => {
      const f = (fields || []).find(x => x.label === label);
      return (f && f.value) || '';
    };
    return items.map(item => ({
      fields: [
        { label: 'ATQ Ref. No.', value: wide('ATQ Ref. No.') },
        { label: 'Item No.', value: item.itemNo || '' },
        { label: 'Product Type', value: item.productType || '' },
        { label: 'Service Type', value: item.serviceType || '' },
        { label: 'Vendor / Distributor', value: item.vendor || '' },
        { label: 'Back-to-Back (Y/N)', value: item.backToBack || '' },
        { label: 'Total Value of Quotation (HKD)', value: item.totalValueOfQuotation || '' },
        { label: 'Quotation', value: item.quotation || '' },
        { label: 'Remark', value: item.remark || '' },
        { label: 'Customer Name', value: wide('Customer Name') },
        { label: 'Project Description', value: wide('Project Description') },
        { label: 'Agreement Number', value: wide('Agreement Number') },
        { label: '(Min)Contract Start Date', value: wide('(Min)Contract Start Date') },
        { label: '(Max)Contract End Date', value: wide('(Max)Contract End Date') },
      ].filter(f => f.value !== ''),
      quotationRef: item.quotation || '',
    }));
  }

  // ---------- One ATQ, two attachments ----------
  //
  // The same ATQ reaches an email twice: as the workbook it was exported from
  // and as a PDF print of that workbook. Both produce records, so the email's
  // roll-up reported eight items for a four-item Cost sheet until this ran.
  //
  // Where a reference identifies which ATQ a record describes, records are
  // grouped by it, and a group holding workbook records drops the PDF's copies.
  // The workbook wins because it is the exported source — exact values, no OCR,
  // no layout inference — and because when a request covers only some of an
  // ATQ's items the workbook is already narrowed to those ("(Item 2).xlsx"
  // against an approved PDF of the whole form), so taking the PDF would add
  // items this requisition is not for.
  //
  // Records whose ATQ cannot be named are always kept, from either source: a
  // duplicate is a nuisance a person can see, a silently dropped item is a
  // wrong purchase requisition.
  //
  // ---------- The two attachments are not always the same REVISION ----------
  //
  // Measured: one email carries `ATQ-202607-00201-V01.xlsx` beside
  // `ATQ-202607-00201-V02...pdf`. Grouping on the whole reference put them in
  // two groups, so the group holding the print had no workbook in it, nothing
  // was dropped, and a one-item ATQ offered THIRTEEN items for selection --
  // the workbook's one and the print's twelve. The mechanism was right; the
  // key just never considered that the same ATQ arrives twice at different
  // revisions. So records group on the ATQ's IDENTITY, with the `-V##` cut off.
  //
  // Within a group the workbook still wins, for the reasons above, and among
  // workbooks the LATEST revision wins. What it deliberately does NOT do is let
  // a newer PRINT beat the workbook: the item list a requisition covers comes
  // from the Cost worksheet, and that is the whole reason the workbook is
  // preferred in the first place.
  //
  // That leaves a real hazard, and it is the reason `supersededBy` exists
  // rather than this being a two-line key change. On the measured email the
  // workbook is V01 and the print is V02, so the kept values are the OLDER
  // ones -- and V02 exists precisely because a price moved. Dropping the print
  // silently would turn a visible duplicate into an invisible wrong number,
  // which is the trade the comment at the top of this file refuses everywhere
  // else. So a kept record whose group contains a HIGHER revision it did not
  // come from is stamped with that revision, and the App says so on screen.
  // Nothing is chosen for the reviewer; they are told the choice exists.
  const ATQ_REF_IN_FILENAME = /ATQ-\d{6}-\d{5}-V\d{2}/i;

  function atqRefOf(rec) {
    const field = (rec.fields || []).find(f => f.label === 'ATQ Ref. No.');
    const fromField = ((field && field.value) || '').trim();
    if (fromField) return fromField.toUpperCase();
    // The PDF print does not always carry the reference as a field, but both
    // attachments are named after it.
    const m = ATQ_REF_IN_FILENAME.exec(rec.sourceFile || '');
    return m ? m[0].toUpperCase() : '';
  }

  function isWorkbookRecord(rec) {
    return /\.xlsx?$/i.test(rec.sourceFile || '');
  }

  // The trailing revision, and the ATQ identity underneath it. Anchored at the
  // end so a reference that carries no revision keeps its whole self as the
  // identity rather than losing a chunk out of its middle.
  const ATQ_REVISION = /-V(\d+)$/i;

  function atqIdentityOf(ref) {
    return ref.replace(ATQ_REVISION, '');
  }

  // -1, not 0, for a reference with no revision at all: a real V00 would
  // otherwise be indistinguishable from "does not say", and the two want
  // opposite answers when the newest is being picked.
  function atqRevisionOf(ref) {
    const m = ATQ_REVISION.exec(ref);
    return m ? parseInt(m[1], 10) : -1;
  }

  // Returns the records to keep plus the Set of dropped ones, so the caller can
  // take them out of the per-attachment lists too — those hold the same objects.
  function dedupeAtqRecords(records) {
    const byId = new Map();
    const refOf = new Map();
    for (const rec of records) {
      const ref = atqRefOf(rec);
      if (!ref) continue;
      refOf.set(rec, ref);
      const id = atqIdentityOf(ref);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(rec);
    }
    const dropped = new Set();
    const revOf = rec => atqRevisionOf(refOf.get(rec) || '');
    byId.forEach(group => {
      const books = group.filter(isWorkbookRecord);
      if (!books.length) return;
      const newestBook = books.reduce((hi, rec) => Math.max(hi, revOf(rec)), -1);
      group.forEach(rec => {
        if (!isWorkbookRecord(rec) || revOf(rec) < newestBook) dropped.add(rec);
      });
      // A revision the workbook does not have. The records that survived are
      // the older ones, and the reviewer is the only one who can judge whether
      // that matters, so they are told rather than overruled.
      const newer = group.filter(rec => revOf(rec) > newestBook)
        .sort((a, b) => revOf(b) - revOf(a))[0];
      if (!newer) return;
      const supersededBy = refOf.get(newer);
      group.forEach(rec => { if (!dropped.has(rec)) rec.supersededBy = supersededBy; });
    });
    return { kept: records.filter(rec => !dropped.has(rec)), dropped };
  }

  const NO_QUOTATION_MATCH = '(no matching attachment)';

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Resolves each record's quotationRef to the sibling attachment(s) filed
  // under it — "QT-2600008" -> "QT-2600008_HKT_HKDC_System Inspection (1).pdf".
  // The reference normally opens the filename; the looser
  // anywhere-in-the-filename pass is only reached when nothing starts with it,
  // so a prefixed variant ("Signed_QT-2600008.pdf") still resolves. Both passes
  // require the reference to end on a non-alphanumeric boundary, otherwise a
  // truncated reference would match a longer one ("QT-260" vs "QT-2600008").
  // More than one file can match (e.g. an original plus a signed copy).
  // Filenames only — the documents themselves are never inspected.
  function filesUnderReference(ref, candidates) {
    const esc = escapeRegExp(ref);
    const atStart = new RegExp('^' + esc + '(?![A-Za-z0-9])', 'i');
    const anywhere = new RegExp('(^|[^A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', 'i');
    const opening = candidates.filter(c => atStart.test(c.base)).map(c => c.name);
    if (opening.length) return opening;
    return candidates.filter(c => anywhere.test(c.base)).map(c => c.name);
  }

  // A Cost sheet's Quotation cell often names the reference and then says what
  // it is for — "<ref> - hardware" — and nothing is filed under that whole
  // string. Only a dash with whitespace beside it separates a descriptor: a
  // bare reference is one token, while "<ref> - System Inspection" is a
  // reference and a description. The head must still look like a reference
  // (five characters, no space, at least one digit) so that a cell reading
  // "Maintenance - 2026" cannot degrade into a search for "Maintenance".
  const REF_DESCRIPTOR_SPLIT = /\s[-–—]\s*|\s*[-–—]\s/;

  function referenceHead(ref) {
    const head = ref.split(REF_DESCRIPTOR_SPLIT)[0].trim();
    if (head === ref || head.length < 5 || /\s/.test(head) || !/\d/.test(head)) return '';
    return head;
  }

  function matchQuotationAttachments(records, fileNames) {
    records.forEach(rec => {
      const ref = (rec.quotationRef || '').trim();
      let files = [];
      if (ref) {
        const candidates = fileNames
          .filter(name => name !== rec.sourceFile)   // the workbook can't be its own quotation
          .map(name => ({ name: name, base: name.replace(/\.[^.]+$/, '') }));
        files = filesUnderReference(ref, candidates);
        if (!files.length) {
          const head = referenceHead(ref);
          if (head) files = filesUnderReference(head, candidates);
        }
      }
      rec.quotationFiles = files;
      // Appended (not pushed) so the record's own fields array, which came from
      // processExcel, isn't mutated. Any earlier answer is dropped first:
      // resumeDeferredOcr re-runs the container aggregation over these same
      // record objects, and appending unconditionally would leave the record
      // carrying one Quotation Document field per pass. On a first pass there
      // is nothing to drop, so this reads exactly as it did before.
      rec.fields = rec.fields
        .filter(f => f.label !== 'Quotation Document')
        .concat([{ label: 'Quotation Document', value: files.join('; ') || NO_QUOTATION_MATCH }]);
    });
  }

  // ---------- Excel: native tables via SheetJS, no OCR needed ----------
  function processExcel(file) {
    return file.arrayBuffer().then(buf => {
      const wb = XLSX.read(buf, { type: 'array' });
      const sheets = wb.SheetNames.map((name, idx) => {
        const sheet = wb.Sheets[name];
        const html = XLSX.utils.sheet_to_html(sheet, { header: '', footer: '' });
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return { pageNum: idx + 1, sheetName: name, html, csv };
      });
      const sheetDump = sheets.map(s => `Sheet: ${s.sheetName}\n${trimEmptyCsv(s.csv)}`).join('\n\n');
      // Emitted for every workbook, ATQ-shaped or not: `records` is the
      // per-purchased-item view and only exists for the ATQ template, whereas
      // `fields` is the same flat Extracted Fields list every other format
      // produces — a workbook and a PDF of the same document should answer the
      // same questions.
      const fields = canonicalizeFields(extractFieldsFromWorkbook(wb));

      if (isAtqWorkbookFile(file.name)) {
        const records = parseAtqWorkbook(wb);
        if (records && records.length) {
          const summary = records.map((rec, i) =>
            `Record ${i + 1}\n` + rec.fields.map(f => `  ${f.label}: ${f.value}`).join('\n')
          ).join('\n\n');
          return { plainText: summary + '\n\n' + sheetDump, hadOcr: false, fields, records, pages: sheets };
        }
      }
      return { plainText: sheetDump, hadOcr: false, fields, pages: sheets };
    });
  }

  // ---------- Spreadsheet field detection ----------
  //
  // A workbook carries the same "Label / value" forms a PDF does, only laid out
  // in cells instead of text runs — so without this a Cisco price quotation or
  // an ATQ workbook contributed zero Extracted Fields while the *same document
  // as a PDF* yielded dozens. Rather than route the CSV dump back through
  // extractFieldsFromBlocks (which would have to re-guess column boundaries
  // that the sheet already states exactly), pair cells directly.
  //
  // The one thing that has to be got right is not mistaking a data table's
  // header row for a form row: "Product Number | Product Description | ..."
  // would otherwise emit "Product Number = Product Description". Tables are
  // identified structurally — several consecutive wide rows filling the same
  // columns — and skipped whole.
  const SHEET_MIN_TABLE_CELLS = 4;   // narrower rows are forms, not tables
  const SHEET_MIN_TABLE_ROWS = 3;    // a lone wide row is a form, not a table
  const SHEET_MAX_FIELDS = 120;
  const SHEET_MAX_VALUE_CHARS = 300;

  function sheetFilledCols(row) {
    const cols = [];
    for (let i = 0; i < row.length; i++) {
      if (normalizeHeader(row[i]) !== '') cols.push(i);
    }
    return cols;
  }

  // A cell that already states its own value is not a label waiting for one in
  // the next cell. Empty columns are collapsed away before pairing, so a row
  // gets read straight across the sheet, and a self-contained cell on the far
  // left then swallows the label belonging to a block on the far right:
  //
  //   A "Date: 29-Mar-2026"   J "Estimate ID:"   L "JD166318974RI"
  //
  // paired A with J, which reported the estimate's own reference as a *value*
  // and dropped its real one — so a Cisco price estimate contributed no
  // quotation number at all. Same row shape put "Valid through: 21-Nov-2026" in
  // front of "Product Total" and "FOB Point: None" in front of "Service Total".
  //
  // Such a cell is not discarded — it is read as the pair it already is, the
  // same way matchInline reads one out of a text line. Dropping it instead
  // would have thrown away "Parent QRN : SHK70527C0" on thirteen real Avaya
  // quote workbooks, where it is the only place that reference appears.
  //
  // Note what this deliberately does NOT do: it says nothing about how far
  // apart the two cells are. A wide sheet legitimately prints a total's label
  // at the left edge and its figure at the right — measured on those same Avaya
  // workbooks, where "Grand Total" and "Quote Total Price" are the widest pairs
  // on the sheet — so distance alone cannot tell a column boundary from a
  // stretched-out form row.
  const SHEET_SELF_CONTAINED = /[:：]\s*\S/;

  // A row belongs to a table when it and SHEET_MIN_TABLE_ROWS-1 of its
  // neighbours are all wide and land on mostly the same columns.
  function markSheetTableRows(filled) {
    const isWide = filled.map(cols => cols.length >= SHEET_MIN_TABLE_CELLS);
    const shared = (a, b) => {
      const set = new Set(b);
      return a.filter(c => set.has(c)).length;
    };
    const tabular = filled.map(() => false);
    for (let i = 0; i < filled.length; i++) {
      if (!isWide[i]) continue;
      let run = 1;
      for (let j = i + 1; j < filled.length && isWide[j] && shared(filled[i], filled[j]) >= 3; j++) run++;
      if (run >= SHEET_MIN_TABLE_ROWS) {
        for (let j = i; j < i + run; j++) tabular[j] = true;
        i += run - 1;
      }
    }
    return tabular;
  }

  // Pairs each labelish cell with the next non-empty cell to its right.
  // A label whose "value" is itself labelish *and* has two or more further
  // cells behind it is a section heading sitting in front of a form row
  // ("Quote Info | Quote Number | 482022078"), so it is skipped rather than
  // paired with the label that follows it.
  function extractFieldsFromSheet(sheet) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    if (!rows.length) return [];
    const filled = rows.map(sheetFilledCols);
    const tabular = markSheetTableRows(filled);

    const fields = [];
    for (let r = 0; r < rows.length && fields.length < SHEET_MAX_FIELDS; r++) {
      if (tabular[r]) continue;
      const cols = filled[r];
      if (cols.length < 2) continue;                       // section title / stray cell
      const cells = cols.map(c => normalizeHeader(rows[r][c]));
      // Runs to the last cell, not to the second-to-last: a cell that states
      // its own value needs no cell after it, and on the Avaya workbooks the
      // row's LAST cell is the one holding "Parent QRN : SHK70527C0".
      for (let i = 0; i < cells.length; i++) {
        const bare = cells[i].replace(/[:：]\s*$/, '').trim();
        if (!isLabelish(bare)) continue;
        if (SHEET_SELF_CONTAINED.test(bare)) {              // states its own value
          const inline = matchInline(bare);
          const own = inline && inline[1].trim();
          if (own && isLabelish(own, LABEL_MAX_WORDS_PUNCTUATED)) {
            fields.push({ label: own, value: inline[2].trim().slice(0, SHEET_MAX_VALUE_CHARS) });
          }
          continue;                                         // never pairs rightwards
        }
        if (i + 1 >= cells.length) break;                   // a bare label with nothing after it
        const value = cells[i + 1];
        const remaining = cells.length - (i + 2);
        if (isLabelish(value) && remaining >= 2) continue;  // heading, not a label
        fields.push({ label: bare, value: value.slice(0, SHEET_MAX_VALUE_CHARS) });
        i++;                                                // the value is consumed
      }
    }
    return fields;
  }

  function extractFieldsFromWorkbook(wb) {
    const fields = [];
    const seen = new Set();
    for (const name of wb.SheetNames) {
      for (const f of extractFieldsFromSheet(wb.Sheets[name])) {
        const key = f.label.toLowerCase();
        if (!f.value || seen.has(key)) continue;
        seen.add(key);
        fields.push(f);
      }
    }
    return fields;
  }

  // sheet_to_csv() dumps the sheet's whole "used range", which for report-style
  // exports is often hundreds of empty trailing columns/rows -- as plain text
  // that reads as a wall of commas (easily mistaken for garbled/corrupted text).
  // Strip trailing empty fields per row and drop fully-blank rows; real content
  // (including interior blank cells) is untouched.
  function trimEmptyCsv(csv) {
    return csv
      .split(/\r?\n/)
      .map(row => row.replace(/,+$/, ''))
      .filter(row => row.length > 0)
      .join('\n');
  }

  // Collapses the per-page marks into one answer about the document. Pages
  // carry `marks: []` when they were inspected and had nothing, and no `marks`
  // property at all when they were never inspected — "not signed" and "not
  // checked" are different answers and only the first one is safe to give.
  function summarizeSigning(pageBlocksList, plainText) {
    const inspected = pageBlocksList.filter(p => Array.isArray(p.marks));
    const marks = [];
    inspected.forEach(p => p.marks.forEach(m => marks.push(Object.assign({ page: p.pageNum }, m))));
    return {
      inspected: inspected.length,
      pagesNotInspected: pageBlocksList.length - inspected.length,
      // Whether the document ASKS to be signed. An unsigned agreement and a
      // signed one both have this; only the marks tell them apart.
      signatureBlock: SIGNATURE_BLOCK_RE.test(plainText),
      hasSignature: marks.some(m => m.kind === 'signature'),
      hasChop: marks.some(m => m.kind === 'chop'),
      marks,
    };
  }

  // Reported as ordinary fields so they land in the same table, export and
  // per-attachment comparison as everything else the document says about
  // itself. `derived` marks them as ours rather than the document's, which is
  // what keeps the OCR reconciliation from trying to "repair" the wording.
  function signingFields(signing) {
    if (!signing.inspected) return [];
    const answer = (kind) => {
      const marks = signing.marks.filter(m => m.kind === kind);
      if (!marks.length) return signing.pagesNotInspected ? 'Not found on the pages checked' : 'Not found';
      const pages = Array.from(new Set(marks.map(m => m.page)));
      // Who the mark belongs to — a name a reviewer can check against the
      // counterparty beats a bare yes/no. The printed sign-off block above the
      // mark is preferred over what OCR made of the chop itself: measured on
      // real documents the chop's own reading is usually an unreadable arc,
      // and when it is not, it is often the sign-off line bleeding into the
      // crop. Only present when the caller asked for `markContext`, so a
      // two-argument parseFile still reports exactly what it used to. Several
      // chops on one document keep their names distinct rather than collapsed
      // into one string no one page actually shows.
      const names = Array.from(new Set(
        marks.map(m => (m.context && m.context.name) || m.text).filter(Boolean)));
      const suffix = names.length ? ` — "${names.join('", "')}"` : '';
      return `Yes (page ${pages.join(', ')})${suffix}`;
    };
    const fields = [
      { label: 'Signature', value: answer('signature'), derived: true },
      { label: 'Company Chop', value: answer('chop'), derived: true },
    ];
    if (signing.signatureBlock) {
      fields.push({ label: 'Signature Block', value: 'Present', derived: true });
    }
    return fields;
  }

  // Turns a pageBlocksList (array of {pageNum, blocks, ocr}) into the flat
  // {plainText, hadOcr, fields} shape — same reduction Docparse's
  // appendDocBody does while rendering, minus any DOM writes.
  function summarizePages(pageBlocksList) {
    const allParaBlocks = [];
    const allTables = [];
    const plainTextParts = [];
    pageBlocksList.forEach(({ blocks }) => {
      blocks.forEach(block => {
        if (block.type === 'table') {
          plainTextParts.push(block.rows.map(r => r.join('\t')).join('\n'));
          allTables.push(block.rows);
        } else {
          plainTextParts.push(block.lines.join('\n'));
          allParaBlocks.push(block.lines);
        }
      });
    });
    const plainText = plainTextParts.join('\n\n');
    const signing = summarizeSigning(pageBlocksList, plainText);
    // Paragraph fields first: where the same label appears in both, the prose
    // copy came from a line the layout pass kept intact, while the table copy
    // survived column clustering. dedupeFields keeps the first.
    const documentFields = canonicalizeFields(mergeAtqFields(
      dedupeFields(extractFieldsFromBlocks(allParaBlocks)
        .concat(extractFieldsFromTables(allTables))),
      plainText));
    const records = atqRecordsFromTables(allTables, documentFields);
    return {
      plainText,
      hadOcr: pageBlocksList.some(p => p.ocr),
      signing,
      // True when OCR ran out of time and later pages went unread. The fields
      // present are real; the set of them is incomplete, and a viewer should
      // say so rather than let the document look fully read.
      truncated: pageBlocksList.some(p => p.truncated),
      fields: documentFields.concat(signingFields(signing)),
      // Only an ATQ produces these — one record per purchased item, the same
      // shape the workbook path returns. Absent on every other document.
      records: records || undefined,
      pages: pageBlocksList,
      // Page numbers still owed a real read — non-empty only under deferOcr.
      // A standalone scanned PDF/image opened directly (not via an email)
      // has no attachment list to report pending-ness through, so it has to
      // land here instead of on a `docs[]` entry.
      pendingDocs: pageBlocksList.filter(p => p.ocrPending).map(p => p.pageNum),
    };
  }

  // ---------- Email formats (.msg / .eml): email body + attachments, reusing
  // the parsers above for each supported attachment type. .msg requires
  // msgreader.min.js (vendored @kenjiuno/msgreader); .eml requires
  // postal-mime.min.js (vendored postal-mime) to be loaded first. ----------
  function stripHtmlToText(html) {
    const div = (typeof document !== 'undefined') ? document.createElement('div') : null;
    if (!div) return html.replace(/<[^>]+>/g, ' ');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
  }

  // ---------- File-type identification ----------
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'];

  // Every spreadsheet format SheetJS can read, in ONE list -- previewKindFor
  // and parseByExt both read it, so "the viewer shows it" and "the parser
  // reads it" cannot drift apart. XLSX.read() sniffs the bytes itself
  // (processExcel passes no format hint), so widening this list is genuinely
  // the whole change: nothing downstream branches on which flavour it was.
  //
  // Why a list rather than /^xl/: .ods and .csv are not Excel's, and .xlsx
  // shares its first two letters with nothing else that matters. The measured
  // gap this closes is `.xlt` -- an Excel TEMPLATE, which a sender produces
  // simply by saving from a template file, and which used to fall through to
  // previewKind 'other': a filename and a download button, no preview and no
  // fields, indistinguishable on screen from a format nothing can read.
  //
  // Deliberately NOT here: 'txt', 'html'/'htm' and 'prn'. SheetJS parses all
  // three, but they already resolve to text/html previews that are right far
  // more often -- a .txt is a text file that SheetJS would happily show as a
  // one-column table.
  const SHEET_EXTS = [
    'xlsx', 'xlsm', 'xlsb', 'xls',          // Excel workbooks, current and legacy
    'xlt', 'xltx', 'xltm',                  // Excel templates
    'xlw',                                  // Excel workspace
    'ods', 'fods',                          // OpenDocument / Flat ODS
    'et', 'ett',                            // WPS Office (common in HK/CN mail)
    'numbers',                              // Apple Numbers (SheetJS reads it)
    'csv', 'dif', 'slk', 'dbf',             // the plain tabular interchange formats
  ];

  // Only the types anything here can act on. Anything absent falls through to
  // "no usable extension", which is the honest answer.
  const MIME_EXT = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template': 'xltx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-excel.sheet.macroEnabled.12': 'xlsm',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12': 'xlsb',
    'application/vnd.ms-excel.template.macroEnabled.12': 'xltm',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'text/csv': 'csv',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/webp': 'webp',
    'multipart/related': 'mht',
    'application/x-mimearchive': 'mht',
    'message/rfc822': 'eml',
    'application/vnd.ms-outlook': 'msg',
    'text/html': 'html',
    'text/plain': 'txt',
  };

  // Filename first, Content-Type only when the filename says nothing useful.
  // Senders mislabel constantly — the demo email carries a .mht attachment
  // typed "application/octet-stream" — whereas the filename is what both the
  // sender and the user actually see. The fallback also covers a real bug:
  // a PostalMime attachment with no filename gets the placeholder
  // "attachment_3", whose trailing-dot "extension" was the whole name.
  function extFor(fileName, mimeType) {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName || '');
    if (m) return m[1].toLowerCase();
    const hit = MIME_EXT[(mimeType || '').split(';')[0].trim().toLowerCase()];
    return typeof hit === 'string' ? hit : '';
  }

  // Plain text, the format previewKindFor has always claimed to handle.
  //
  // previewKindFor answers 'text' for a .txt and parseByExt had no branch for
  // one, so the two halves disagreed and both outcomes were silent: a .txt
  // ATTACHMENT came back `status: 'skipped'` with the engine's own apology in
  // its textBlock, and a .txt handed straight to parseFile threw
  // `Unsupported file type: .txt`. The viewer's text pane had nothing to draw
  // in either case -- which is why the "previews as text" half of the App's
  // VIEWER_TEXT_EXTS needs this branch to exist at all.
  //
  // Opt-in (`textAttachments`), the same rule every other parameter here
  // follows: a skipped attachment becoming a parsed one, and a throw becoming a
  // result, are both visible changes to what a two-argument parseFile does.
  //
  // Deliberately NOT here: 'csv', 'prn', 'html'/'htm'. The first is a
  // SHEET_EXTS member and reads far better as a grid; the last two already have
  // an html preview. One extension, one answer.
  const TEXT_EXTS = ['txt', 'log', 'md', 'json', 'ini'];

  // Which decoder a text file's own first bytes ask for.
  //
  // The UTF-8 BOM needs nothing: TextDecoder strips a leading one unless
  // `ignoreBOM` is set, so a hand-rolled /^\uFEFF/ replace here is dead code --
  // measured, after writing one and watching a mutation of it change nothing.
  //
  // UTF-16 is the case that actually needs reading, and Notepad is why: its
  // "Unicode" save is UTF-16LE, and those bytes through a UTF-8 decoder come
  // back as `\uFFFD\uFFFD A \u0000 B \u0000` -- mojibake on screen, every label
  // pattern missing, and no error anywhere to say the file was read wrong.
  function charsetFromBom(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
    return 'utf-8';
  }

  async function processText(file, notify, depth) {
    // Nested, the container's attachment loop owns the status line.
    if (!depth) notify('Reading text file…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = decodeMimeText(bytes, charsetFromBom(bytes));
    // Blank-line-separated paragraphs, which is the same shape the layout pass
    // hands summarizePages for a PDF -- so a text file's "Quotation No.: X"
    // line becomes an Extracted Field by exactly the rules every other format
    // goes through, rather than by a second copy of them.
    const blocks = [];
    let cur = [];
    text.split(/\r\n|\r|\n/).forEach(line => {
      if (line.trim()) { cur.push(line); return; }
      if (cur.length) { blocks.push({ lines: cur }); cur = []; }
    });
    if (cur.length) blocks.push({ lines: cur });
    // An empty file is still a parsed document, not a failed one: one empty
    // block keeps summarizePages' shape and the pane says "(no text)".
    return summarizePages([{ pageNum: 1, blocks: blocks.length ? blocks : [{ lines: [''] }], ocr: false }]);
  }

  // How a viewer should show the original, as opposed to how it is parsed:
  // 'other' still gets a filename and a download, which is more than the
  // format's absence from parseByExt would suggest.
  function previewKindFor(ext) {
    if (ext === 'pdf') return 'pdf';
    if (IMAGE_EXTS.includes(ext)) return 'image';
    if (SHEET_EXTS.includes(ext)) return 'sheet';
    if (ext === 'mht' || ext === 'mhtml' || ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'txt') return 'text';
    return 'other';
  }

  // Attachment counts above this get a heads-up in the status line before
  // processing starts — purely informational, nothing is blocked or capped.
  const MANY_ATTACHMENTS_THRESHOLD = 10;
  // Guards against one hung/corrupt attachment (e.g. a malformed PDF that
  // never resolves) blocking every attachment after it — such an attachment
  // is reported as failed, same as a parse error, and the loop moves on.
  //
  // This is a *hard* stop that throws away whatever the attachment had read so
  // far, which is the wrong outcome for a slow-but-working multi-page scan:
  // OCR legitimately needs a minute or two, and at 45s a real signed agreement
  // was being dropped entirely. So the hard stop is set well clear of honest
  // work, and OCR gets a shorter soft deadline (ATTACHMENT_OCR_BUDGET_MS)
  // that makes it stop after the page it is on and hand back the pages it has.
  // The gap between the two is deliberately wide. The soft deadline is only
  // checked *between* pages, so whatever page is in flight when it expires
  // still has to finish — and if that overrun crossed the hard timeout, the
  // partial result the soft deadline exists to preserve would be thrown away
  // anyway. The gap is therefore one slow page's worth, generously sized: a
  // full-page A4 scan takes the better part of two minutes on a laptop.
  //
  // The soft budget is what actually governs how long an attachment may spend,
  // and it is set to let a multi-page signed agreement — the document these
  // emails most often carry as a scan, and the one whose totals need checking
  // against the ATQ — finish rather than be cut off mid-way.
  const ATTACHMENT_OCR_BUDGET_MS = 420000;
  // Also the ceiling the ink pass (inspectPagesForMarks) is capped against:
  // it runs after the OCR page loop already spent up to ATTACHMENT_OCR_BUDGET_MS
  // (plus one page's overrun), and it must leave the hard timeout below room to
  // actually fire rather than eating the same buffer the OCR overrun already did.
  const ATTACHMENT_HARD_BUFFER_MS = 150000;
  const ATTACHMENT_TIMEOUT_MS = ATTACHMENT_OCR_BUDGET_MS + ATTACHMENT_HARD_BUFFER_MS;

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms);
      promise.then(
        v => { clearTimeout(timer); resolve(v); },
        e => { clearTimeout(timer); reject(e); }
      );
    });
  }

  // Lets the browser paint/respond to input between attachments — the parse
  // work itself (PDF render, OCR inference) is synchronous-feeling CPU work,
  // so without this the tab can look frozen for the whole email on a long
  // attachment list.
  function yieldToUi() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  // The single registration point for every supported format — a new format is
  // one line here and nothing else. `depth` is how deep inside containers this
  // file sits (0 = the file the user picked); container formats refuse to nest,
  // so there is no unbounded recursion. Returns null for anything unsupported,
  // which each caller turns into its own kind of "skipped".
  async function parseByExt(file, ext, notify, depth, deadline, opts) {
    if (SHEET_EXTS.includes(ext)) {
      // Only at top level: inside an email this would stomp on the
      // "Parsing email attachment 3/8…" progress line.
      if (depth === 0) notify('Reading spreadsheet…');
      return processExcel(file);
    }
    if (TEXT_EXTS.includes(ext)) {
      return (opts && opts.textAttachments) ? processText(file, notify, depth) : null;
    }
    if (ext === 'pdf') return summarizePages(await processPdf(file, notify, deadline, opts));
    if (IMAGE_EXTS.includes(ext)) return summarizePages(await processImage(file, notify, deadline, opts));
    // A web archive may sit inside an email, but nothing below that: at depth 2
    // the archive's own embedded documents would start unpacking archives of
    // their own.
    if (ext === 'mht' || ext === 'mhtml') return depth <= 1 ? processMht(file, notify, depth, opts) : null;
    // An email inside an email is real mail, not a pathology: a forwarded PR
    // request arrives as a .msg attached to a .msg, and until now that inner
    // email was ONE skipped attachment -- a filename and a download button,
    // with its own attachments (the agreement, the ATQ) never reached at all.
    // The ceiling is the same one .mht has and for the same reason: at depth 2
    // the inner email's attachments would start unpacking emails of their own.
    //
    // Opt-in (`nestedEmails`), because one skipped attachment becoming a parsed
    // document with children of its own is a visible change to what a
    // two-argument parseFile returns, and Docparse/index.html is a separate
    // consumer whose output must not move.
    const emailDepthOk = depth === 0 || (depth <= 1 && !!(opts && opts.nestedEmails));
    if (ext === 'msg') return emailDepthOk ? processMsg(file, notify, depth, opts) : null;
    if (ext === 'eml') return emailDepthOk ? processEml(file, notify, depth, opts) : null;
    return null;
  }

  // Outlook's automatic naming for inline logos and signature images. Nothing a
  // human attaches uses it — IMG_1234.jpg, chop.jpg and Signed scan.pdf all
  // miss — so the two conventions don't collide.
  const FURNITURE_NAME = /^(image|oledata|logo)0*\d*\.(png|jpe?g|gif|bmp|mso)$/i;
  const FURNITURE_MAX_BYTES = 200 * 1024;

  // Tells an email's layout furniture apart from its documents. Deliberately
  // does NOT look at Content-Disposition: Outlook exports signature logos as
  // `Content-Disposition: attachment` with no Content-ID at all, so any
  // disposition-based rule reads the real thing exactly backwards. The name
  // convention plus a small-file ceiling is what actually holds, and the UI
  // keeps an "+ N inline images" expander so a chop photographed straight into
  // the body is still reachable.
  function isInlineFurniture(att, size) {
    if (att.related === true || att.contentId) return true;
    return FURNITURE_NAME.test(att.fileName || '') && size < FURNITURE_MAX_BYTES;
  }

  // Retention ceilings for the original bytes. Only pathological mail reaches
  // them — the demo's eight attachments come to ~3 MB together. Past the cap
  // the text is still parsed and only the original is dropped; a doc with a
  // size but no blob is how the viewer knows to say so.
  const MAX_RETAINED_BYTES = 25 * 1024 * 1024;
  const MAX_RETAINED_TOTAL = 80 * 1024 * 1024;

  // Folds one attachment's parse result into its `doc` descriptor. `attResult`
  // is null for an unsupported file type. Shared by the first pass and by
  // resumeDeferredOcr, which re-parses a document and has to land the new
  // answer in exactly the same fields.
  //
  // `textBlock` is the one field with no counterpart in the parse result: it is
  // this attachment's contribution to the container's plainText, kept on the
  // doc so finalizeEmailResult can rebuild that text from docs[] alone rather
  // than from a list only the first pass's loop ever had.
  //
  // Retention of the original bytes is deliberately NOT done here — only the
  // first pass has a retention budget to spend, and by the time a document can
  // be resumed at all it already has its blob.
  function applyAttachmentResult(doc, attResult, fileName) {
    if (!attResult) {
      const note = `[Attachment: ${fileName}] — unsupported file type, skipped`;
      doc.note = note;
      doc.textBlock = note;
      return;
    }
    doc.textBlock = `=== Attachment: ${fileName} ===\n\n${attResult.plainText}`;
    // Same objects in both lists, so the quotation matching in
    // finalizeEmailResult enriches the per-document view too.
    doc.records = (attResult.records || []).map(r => ({ ...r, sourceFile: fileName }));
    doc.status = 'parsed';
    doc.hadOcr = !!attResult.hadOcr;
    doc.truncated = !!attResult.truncated;
    doc.signing = attResult.signing || null;
    doc.fields = attResult.fields || [];
    doc.pageCount = (attResult.pages || []).length;
    doc.ocrPending = !!(attResult.pendingDocs && attResult.pendingDocs.length);
    doc.resumable = doc.ocrPending && !!doc.blob;
    // Container formats (.mht) hand back their own sub-documents and a
    // self-contained rendering of themselves; every other format leaves both
    // untouched at their initial empty values.
    doc.children = attResult.attachments || [];
    doc.previewHtml = attResult.previewHtml || '';
    // A container that produced a self-contained rendering of ITSELF can be
    // shown, whatever previewKindFor said about its extension before the parse
    // ran. previewKindFor('eml') is 'other' -- filename and a download button
    // -- which was the only honest answer while the HTML body was thrown away,
    // and is the wrong one now that it is kept. A no-op for every other format:
    // nothing else fills previewHtml.
    if (doc.previewHtml) doc.previewKind = 'html';
  }

  // The container-level aggregation, run once every document's own parse is
  // final. Split out of processEmailAttachments so resumeDeferredOcr can redo
  // it after re-reading some of them: every step here depends on ALL the
  // documents, so a resumed document cannot simply be patched into a previous
  // result.
  function finalizeEmailResult(pages, docs, bodyFields, notify) {
    const bodyText = pages[0].lines.join('\n');
    const plainTextParts = [`=== ${pages[0].label} ===\n\n` + bodyText];
    docs.forEach(doc => { if (doc.textBlock) plainTextParts.push(doc.textBlock); });

    // The clean copy of a document can arrive either before or after the scan
    // of it, so the vocabulary that repairs the scan is only complete once
    // every attachment has been read.
    if (docs.some(d => d.hadOcr)) {
      notify('Reconciling scanned attachments against the others…', 100);
      const vocab = buildCleanVocabulary(docs, bodyText);
      for (const doc of docs) {
        if (doc.hadOcr && doc.fields.length) doc.fields = reconcileOcrFields(doc.fields, vocab);
      }
    }

    // Built from the per-document lists rather than accumulated during the
    // loop, so the reconciled fields are the ones that reach the caller.
    const fields = bodyFields.concat(...docs.map(d => d.fields || []));
    // Same reason, and in document order: dedupeAtqRecords keeps the first of
    // each duplicate group, so a different order would keep a different record.
    let records = docs.flatMap(d => d.records || []);

    // The quotation PDF can arrive either before or after the workbook that
    // references it, so matching needs the full attachment list.
    if (records.length) {
      // Before matching, not after: there is no point resolving quotation
      // filenames for records that are about to be dropped as duplicates.
      const { kept, dropped } = dedupeAtqRecords(records);
      if (dropped.size) {
        records = kept;
        // The per-attachment lists hold the same objects, and the App counts
        // them — leaving them in `records` would count the dropped items a
        // second time there.
        //
        // Moved rather than discarded. A superseded record is the *same items*
        // read out of a second document, which is exactly what a cross-document
        // comparison needs: the workbook says one thing, the PDF print of it
        // says another, and a reviewer wants to know. `records` keeps its
        // meaning — the items this requisition covers, counted once — so every
        // reader of it is untouched, and a consumer that has never heard of
        // `corroboration` behaves exactly as before.
        docs.forEach(doc => {
          if (!doc.records) return;
          const left = doc.records.filter(rec => !dropped.has(rec));
          const superseded = doc.records.filter(rec => dropped.has(rec));
          if (superseded.length) doc.corroboration = superseded;
          if (left.length) doc.records = left;
          else delete doc.records;
        });
      }
      matchQuotationAttachments(records, docs.map(d => d.fileName));
      const lines = records.map((rec, i) =>
        `Record ${i + 1}${rec.quotationRef ? ` (${rec.quotationRef})` : ''}: ` +
        (rec.quotationFiles.length ? rec.quotationFiles.join('; ') : NO_QUOTATION_MATCH)
      );
      plainTextParts.push('=== Quotation documents ===\n\n' + lines.join('\n'));
    }

    const result = {
      plainText: plainTextParts.join('\n\n'),
      hadOcr: docs.some(d => d.hadOcr),
      fields,
      pages,
      attachments: docs,
    };
    if (records.length) result.records = records;
    result.pendingDocs = docs.filter(d => d.ocrPending).map(d => d.index);
    // Kept so a resume can run this same aggregation again. The header and body
    // fields are extracted from two separate blocks (see
    // processEmailAttachments) and cannot be re-derived from pages[0].lines
    // once those blocks have been joined.
    result.bodyFields = bodyFields;
    return result;
  }

  // Shared by processMsg/processEml: given the email's header/body lines and
  // a list of { fileName, mimeType?, getContent: () => Promise<Uint8Array> }
  // attachment descriptors, parses each supported attachment with parseByExt
  // and merges everything into one
  // { plainText, hadOcr, fields, pages, attachments, records? } result. records
  // is only present when an ATQ-shaped Excel attachment was found (see
  // processExcel). `attachments` (the returned one) is the per-document view:
  // original bytes, provenance-carrying fields, and a pagesIndex back into
  // pages[] — deliberately parallel to pages[] rather than folded into it,
  // because pages[] is a render tree and the blobs are source assets.
  //
  // `bodyLabel` names the first page — 'Email Body' for .msg/.eml, 'Web Page'
  // for a .mht archive. Whatever it says, it keeps pages[0].label defined,
  // which is what routes the result to Docparse's appendEmailPages.
  async function processEmailAttachments(headerLines, bodyTextLines, attachments, notify, depth, bodyLabel, opts) {
    const label = bodyLabel || 'Email Body';
    const bodyLines = headerLines.concat([''], bodyTextLines);
    // Header and body are kept as separate blocks so the "Date:" field
    // doesn't swallow the body text as a continuation (extractFieldsFromBlocks
    // only continues a field within a single block).
    const bodyFields = canonicalizeFields(extractFieldsFromBlocks([headerLines, bodyTextLines]));
    const pages = [{ label: label, lines: bodyLines }];
    const docs = [];
    let retainedTotal = 0;

    if (attachments.length > MANY_ATTACHMENTS_THRESHOLD) {
      notify(`⚠ ${attachments.length} attachments found — this may take a while…`);
      await yieldToUi();
    }

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const fileName = att.fileName;
      const ext = extFor(fileName, att.mimeType);
      const pct = Math.round((i / attachments.length) * 100);
      notify(`Parsing email attachment ${i + 1}/${attachments.length}: ${fileName}…`, pct);

      const doc = {
        index: i,
        fileName,
        ext,
        mimeType: att.mimeType || '',
        size: 0,
        blob: null,
        previewKind: previewKindFor(ext),
        status: 'skipped',
        note: '',
        hadOcr: false,
        truncated: false,
        signing: null,
        pageCount: 0,
        inline: false,
        fields: [],
        records: [],
        pagesIndex: -1,
        children: [],
        previewHtml: '',
        ocrPending: false,
        resumable: false,
      };
      docs.push(doc);

      try {
        // Bytes before parsing, and outside withTimeout: decoding an
        // attachment is quick, parsing is what hangs. In this order even a PDF
        // that never finishes rendering can still be viewed and downloaded.
        const content = await att.getContent();
        const attFile = new File([content], fileName);
        doc.size = attFile.size;
        if (attFile.size <= MAX_RETAINED_BYTES && retainedTotal + attFile.size <= MAX_RETAINED_TOTAL) {
          doc.blob = attFile;
          retainedTotal += attFile.size;
        }

        if (isInlineFurniture(att, doc.size)) {
          // A signature logo is not a document: no parse (which is what saves
          // pulling a 30 MB OCR model down to read a letterhead), no pages[]
          // entry, no "=== Attachment: image.png ===" paragraph, no fields to
          // pollute cross-document comparison. The blob stays — a chop is
          // sometimes pasted straight into the body.
          doc.inline = true;
          doc.status = 'inline';
        } else {
          const attResult = await withTimeout(
            parseByExt(attFile, ext, notify, depth + 1, Date.now() + ATTACHMENT_OCR_BUDGET_MS, opts),
            ATTACHMENT_TIMEOUT_MS
          );
          applyAttachmentResult(doc, attResult, fileName);
          doc.pagesIndex = pages.length;
          if (!attResult) {
            pages.push({ label: `Attachment: ${fileName}`, skipped: true, note: doc.note });
          } else {
            if (doc.ocrPending && !doc.blob && opts && opts.retainForResume) {
              // Over the per-file/total retention cap, but this document has
              // pages nobody has read yet — without its original bytes it can
              // never be finished later, which is worse than the cap exists
              // to prevent. Deliberately not counted against MAX_RETAINED_*:
              // those caps bound the ordinary case, not the resumable one.
              doc.blob = attFile;
              retainedTotal += attFile.size;
              doc.resumable = true;
            }
            pages.push({ label: `Attachment: ${fileName}`, pages: attResult.pages });
          }
        }
      } catch (attErr) {
        const note = `[Attachment: ${fileName}] — failed to parse (${attErr.message})`;
        doc.status = 'failed';
        doc.note = note;
        doc.textBlock = note;
        doc.pagesIndex = pages.length;
        pages.push({ label: `Attachment: ${fileName}`, skipped: true, note });
      }
      await yieldToUi();
    }
    // At depth 0 this is the closing line of the whole parse and what drives
    // the progress bar to 100%. Nested — a .mht opened inside an email — the
    // container's own loop owns the status line, so an archive with nothing
    // embedded in it stays quiet rather than resetting the count mid-email.
    if (depth === 0 || attachments.length) notify(`Parsed ${attachments.length} attachment(s).`, 100);

    return finalizeEmailResult(pages, docs, bodyFields, notify);
  }

  // Finishes an email parsed with `deferOcr`: re-reads the documents that came
  // back with pending pages and re-runs the container aggregation over the
  // result. `wantedDocIndexes` limits it to those attachment indexes; falsy or
  // empty means every pending document.
  //
  // Each document is re-parsed whole rather than having its pending pages
  // stitched in. Re-extracting a text layer costs milliseconds, `seedMarks`
  // hands back the ink pass already paid for, and only the pages that were left
  // pending reach OCR — so a full re-parse is both simpler and barely more
  // expensive than a merge would be.
  //
  // `prevResult` is mutated and its own object graph is returned; a document
  // that cannot be resumed leaves the rest resumable rather than failing the
  // whole call.
  async function resumeDeferredOcr(prevResult, wantedDocIndexes, onStatus, opts) {
    const notify = typeof onStatus === 'function' ? onStatus : function () {};
    const docs = prevResult.attachments || [];
    const wanted = wantedDocIndexes && wantedDocIndexes.length ? new Set(wantedDocIndexes) : null;
    const targets = docs.filter(d => d.ocrPending && (!wanted || wanted.has(d.index)));

    for (let i = 0; i < targets.length; i++) {
      const doc = targets[i];
      notify(`Reading attachment ${i + 1}/${targets.length}: ${doc.fileName}…`,
        Math.round((i / targets.length) * 100));
      if (!doc.blob) {
        // Over the retention cap and parsed without retainForResume: the bytes
        // are gone, so this document can never be finished. Said out loud
        // rather than thrown — everything else here is still resumable.
        doc.note = `[Attachment: ${doc.fileName}] — cannot resume, the original file bytes were not retained`;
        continue;
      }
      const page = prevResult.pages[doc.pagesIndex];
      const seedMarks = {};
      ((page && page.pages) || []).forEach(p => {
        if (Array.isArray(p.marks)) seedMarks[p.pageNum] = p.marks;
      });
      try {
        const attResult = await withTimeout(
          parseByExt(doc.blob, doc.ext, notify, 1, Date.now() + ATTACHMENT_OCR_BUDGET_MS,
            { seedMarks, inkBudgetMs: opts && opts.inkBudgetMs,
              // The light pass had no OCR text to name the parties from, so a
              // scanned page's marks reach here without context. This read is
              // the first one that can answer it.
              markContext: opts && opts.markContext }),
          ATTACHMENT_TIMEOUT_MS
        );
        applyAttachmentResult(doc, attResult, doc.fileName);
        if (attResult) page.pages = attResult.pages;
      } catch (err) {
        // ocrPending is left standing, so the same document is retried rather
        // than quietly counted as read.
        doc.note = `[Attachment: ${doc.fileName}] — failed to finish reading (${err.message})`;
      }
      await yieldToUi();
    }

    // dedupeAtqRecords is about to run again, and it needs the full set: a
    // corroboration list is what the PREVIOUS aggregation moved out of
    // doc.records, so re-deduping without it would dedupe an already-trimmed
    // set. Unconditional — putting them back is cheap and always correct.
    docs.forEach(doc => {
      if (!doc.corroboration) return;
      doc.records = (doc.records || []).concat(doc.corroboration);
      delete doc.corroboration;
    });

    const result = finalizeEmailResult(prevResult.pages, docs, prevResult.bodyFields || [], notify);
    // parseFile, not processEmailAttachments, is what describes the user's own
    // pick — and a resume never goes through parseFile, so it has to be carried
    // across by hand or every consumer of it sees the file disappear.
    if (prevResult.self) result.self = prevResult.self;
    return result;
  }

  // ---------- .mht / .mhtml: MIME HTML web archive ----------
  //
  // Hand-written rather than borrowed from postal-mime, for one reason: postal-
  // mime discards Content-Location (grep the bundle — zero hits), and in a Word
  // "Single File Web Page" Content-Location is the ONLY link between the part
  // holding image001.jpg and the <img> that needs it. These parts carry no
  // Content-ID at all, so postal-mime's related-part walker (which requires
  // one) never sees them either.

  const MHT_BAD = 'Not a valid web archive —';

  // Inlining budget for the self-contained preview. Per resource, then per
  // archive: a data: URL costs ~4/3 of the bytes it carries, and the whole
  // string is held in memory as one JS string.
  const MHT_INLINE_MAX = 3 * 1024 * 1024;
  const MHT_TOTAL_MAX = 12 * 1024 * 1024;

  // A .mht is bytes, not text: the HTML part is quoted-printable over big5 in
  // the demo archive, where one Chinese character is two =XX pairs. Decoding
  // the file as text up front would destroy it, so everything below works on a
  // byte-per-char "binary string" and only decodes to real text once the
  // transfer encoding has been undone.
  function bytesToBinaryString(bytes) {
    const CHUNK = 0x8000;                       // apply() has an argument limit
    const out = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return out.join('');
  }

  function binaryStringToBytes(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xFF;
    return out;
  }

  function bytesToBase64(bytes) {
    return btoa(bytesToBinaryString(bytes));
  }

  // RFC 2045 quoted-printable -> BYTES. Returning bytes (not a string) is the
  // whole point: charset decoding has to happen strictly after this step.
  function decodeQuotedPrintable(text) {
    const out = new Uint8Array(text.length);
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 61) {                                       // '='
        // Soft line break: "=" CRLF or "=" LF, tolerating trailing spaces that
        // some encoders leave before the break.
        let j = i + 1;
        while (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9) j++;
        if (text.charCodeAt(j) === 13 && text.charCodeAt(j + 1) === 10) { i = j + 1; continue; }
        if (text.charCodeAt(j) === 10) { i = j; continue; }
        const hex = text.substr(i + 1, 2);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out[n++] = parseInt(hex, 16); i += 2; continue; }
        out[n++] = 61;                                      // stray '=' — keep it
        continue;
      }
      out[n++] = c & 0xFF;
    }
    return out.subarray(0, n);
  }

  function decodeBase64ToBytes(text) {
    try {
      return binaryStringToBytes(atob(text.replace(/[^A-Za-z0-9+/=]/g, '')));
    } catch (e) {
      return new Uint8Array(0);                             // a corrupt part, not a corrupt file
    }
  }

  // Charset decoding, once and only once the bytes are real. An unknown label
  // makes TextDecoder throw; utf-8 is the least-wrong fallback because it fails
  // loudly (replacement characters) rather than silently mis-mapping.
  function decodeMimeText(bytes, charset) {
    try {
      return new TextDecoder(charset || 'utf-8').decode(bytes);
    } catch (e) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  // Header block -> { lowercased-name: value }. Handles RFC 5322 folding: a
  // line starting with space or tab continues the one before it, which is how
  // a long Content-Location or filename survives the 78-column limit.
  function parseMimeHeaders(text) {
    const headers = {};
    let cur = '';
    function flush() {
      const c = cur.indexOf(':');
      if (c > 0) {
        const k = cur.slice(0, c).trim().toLowerCase();
        if (headers[k] === undefined) headers[k] = cur.slice(c + 1).trim();
      }
      cur = '';
    }
    String(text).split(/\r?\n/).forEach(line => {
      if (cur && /^[ \t]/.test(line)) { cur += ' ' + line.replace(/^[ \t]+/, ''); return; }
      flush();
      cur = line;
    });
    flush();
    return headers;
  }

  // One parameter out of a structured header value, quoted or bare:
  // mimeParam('text/html; charset="big5"', 'charset') === 'big5'.
  function mimeParam(value, name) {
    const m = new RegExp('(?:^|;)\\s*' + name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i').exec(value || '');
    if (!m) return '';
    return (m[1] !== undefined ? m[1] : m[2]) || '';
  }

  function buildMhtPart(headers, bodyText) {
    const ct = headers['content-type'] || '';
    const cd = headers['content-disposition'] || '';
    const enc = (headers['content-transfer-encoding'] || '7bit').trim().toLowerCase();
    let bytes;
    if (enc === 'base64') bytes = decodeBase64ToBytes(bodyText);
    else if (enc === 'quoted-printable') bytes = decodeQuotedPrintable(bodyText);
    else bytes = binaryStringToBytes(bodyText);
    return {
      mimeType: ct.split(';')[0].trim().toLowerCase(),
      charset: mimeParam(ct, 'charset'),
      location: (headers['content-location'] || '').trim(),
      contentId: (headers['content-id'] || '').trim().replace(/^</, '').replace(/>$/, ''),
      // Only an explicit name counts. A Content-Location basename is the
      // generator's invention (image001.jpg), not something a human chose.
      fileName: mimeParam(cd, 'filename') || mimeParam(ct, 'name'),
      encoding: enc,
      // Reusing the part's own base64 for the data: URL skips a decode/encode
      // round trip for every image in the archive.
      base64: enc === 'base64' ? bodyText.replace(/[^A-Za-z0-9+/=]/g, '') : '',
      bytes: bytes,
    };
  }

  // Splits the archive on the root Content-Type's boundary. A delimiter only
  // counts at the start of a line, which is what keeps a boundary string that
  // also appears inside a body from cutting the file in the wrong place.
  function splitMhtParts(text) {
    const headSep = /\r?\n\r?\n/.exec(text);
    if (!headSep) throw new Error(`${MHT_BAD} there is no MIME header block.`);
    const rootHeaders = parseMimeHeaders(text.slice(0, headSep.index));
    const boundary = mimeParam(rootHeaders['content-type'], 'boundary');
    if (!boundary) throw new Error(`${MHT_BAD} the Content-Type header names no MIME boundary.`);

    const delim = '--' + boundary;
    const marks = [];
    let closed = false;
    let i = text.indexOf(delim, headSep.index);
    while (i !== -1) {
      if (i === 0 || text.charCodeAt(i - 1) === 10) {
        const closing = text.substr(i + delim.length, 2) === '--';
        marks.push({ at: i, end: i + delim.length });
        if (closing) { closed = true; break; }
      }
      i = text.indexOf(delim, i + delim.length);
    }
    if (!marks.length) throw new Error(`${MHT_BAD} no MIME parts were found in it.`);
    // Everything before the first delimiter is the "this is a Web Archive file"
    // prologue; everything after the closing one is the epilogue. Both are
    // dropped by construction — only the gaps between delimiters are read.
    if (!closed) throw new Error(`${MHT_BAD} the file is truncated (no closing MIME boundary).`);

    const parts = [];
    for (let k = 0; k < marks.length - 1; k++) {
      let s = marks[k].end;
      if (text.charCodeAt(s) === 13) s++;                   // CRLF ending the
      if (text.charCodeAt(s) === 10) s++;                   // delimiter line
      let e = marks[k + 1].at;
      if (text.charCodeAt(e - 1) === 10) e--;               // the CRLF before the
      if (text.charCodeAt(e - 1) === 13) e--;               // next one is its own
      const seg = text.slice(s, Math.max(s, e));
      const sep = /\r?\n\r?\n/.exec(seg);
      parts.push(buildMhtPart(
        parseMimeHeaders(sep ? seg.slice(0, sep.index) : seg),
        sep ? seg.slice(sep.index + sep[0].length) : ''
      ));
    }
    if (!parts.length) throw new Error(`${MHT_BAD} no MIME parts were found in it.`);
    return { rootHeaders: rootHeaders, parts: parts };
  }

  function normLoc(loc) {
    return String(loc || '').split('#')[0].trim().toLowerCase();
  }

  function absLoc(ref, base) {
    try {
      return new URL(ref, base || undefined).href;
    } catch (e) {
      return '';
    }
  }

  // Page furniture uses this vocabulary; a real embedded document does not.
  // .htm/.html is furniture too — a multi-frame archive's sub-frames are part
  // of the page, not attachments to it.
  const MHT_FURNITURE_EXT = ['xml', 'thmx', 'mso', 'css', 'js', 'htm', 'html', 'txt'];

  // Which parts of an archive are documents in their own right (an embedded
  // PDF or workbook) and which are just how the page is drawn (themedata.thmx,
  // filelist.xml, a letterhead logo). Only the former may reach the parse
  // pipeline: OCR'ing a letterhead would pull the ~30 MB PaddleOCR model down
  // to read a logo. The furniture still shows in the preview, inlined as a
  // data: URL by buildMhtPreviewHtml.
  function isMhtDocumentPart(part) {
    const name = mhtPartName(part);
    const ext = extFor(name, part.mimeType);
    if (!ext) return false;
    if (MHT_FURNITURE_EXT.indexOf(ext) !== -1) return false;
    // Same naming convention isInlineFurniture keys off for email attachments.
    if (FURNITURE_NAME.test(name)) return false;
    // An image is only a document when something actually named it. Word names
    // page images image001.jpg via Content-Location and nothing else, so
    // without an explicit filename/name parameter it is page furniture.
    if (IMAGE_EXTS.indexOf(ext) !== -1 && !part.fileName) return false;
    return true;
  }

  // Case is preserved here (normLoc is for matching, not for display): a part
  // named only by its Content-Location should still read "Quote.PDF".
  function mhtPartName(part) {
    if (part.fileName) return part.fileName;
    const segs = String(part.location || '').split('#')[0].split(/[\\/]/).filter(Boolean);
    if (!segs.length) return '';
    const last = segs[segs.length - 1];
    try {
      return decodeURIComponent(last);
    } catch (e) {
      return last;                                        // a stray % is not fatal
    }
  }

  // Removes everything that could act, as defence in depth beneath the
  // sandbox="" iframe the consumer renders this in. Also blanks any src that
  // still points off-box: a sandboxed iframe blocks scripts and navigation but
  // NOT subresource loads, so an un-inlined remote <img> would stay a live
  // tracking pixel. data: URLs (everything already inlined) are left alone.
  function stripActiveHtml(html) {
    return String(html)
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<script\b[^>]*>/gi, '')
      .replace(/<\/?(?:iframe|frame|frameset|object|embed|applet|base)\b[^>]*>/gi, '')
      .replace(/\son[a-z]{3,20}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/((?:href|src|action|formaction|data|codebase)\s*=\s*["']?\s*)javascript:[^"'\s>]*/gi, '$1#')
      .replace(/\s(src|background)\s*=\s*(?:"(?:https?:)?\/\/[^"]*"|'(?:https?:)?\/\/[^']*'|(?:https?:)?\/\/[^\s>]+)/gi, ' $1=""');
  }

  // The document declares its own charset (big5 here), but by the time it
  // reaches a srcdoc it is already a decoded DOMString — leaving the old
  // declaration in place invites a second, wrong decode.
  function retargetMetaCharset(html) {
    return html.replace(/<meta\b[^>]*>/gi, tag =>
      tag.replace(/charset\s*=\s*["']?[A-Za-z0-9_.:-]+/gi, 'charset=utf-8'));
  }

  // Assembles one fully self-contained HTML string: every image and stylesheet
  // the page references becomes a data: URL, so the result needs no companion
  // files and no object URLs.
  //
  // data:, deliberately, not blob:. A sandbox="" iframe has an opaque origin
  // and Chrome will not load blob: subresources into one; data: loads from an
  // opaque origin and from file:// alike, never needs revoking, and cannot
  // leak. (That is also why this is built here and not handed to the UI as a
  // pile of resource blobs.)
  function buildMhtPreviewHtml(htmlPart, pageHtml, parts) {
    const base = htmlPart.location || '';
    const byLoc = {};
    const byCid = {};
    const byTail = {};

    parts.forEach(p => {
      if (p === htmlPart) return;
      if (p.location) {
        byLoc[normLoc(p.location)] = p;
        const abs = absLoc(p.location, base);
        if (abs) byLoc[normLoc(abs)] = p;
      }
      if (p.contentId) byCid[p.contentId.toLowerCase()] = p;
      const segs = normLoc(p.location).split(/[\\/]/).filter(Boolean);
      if (segs.length) {
        const one = segs[segs.length - 1];
        const two = segs.length > 1 ? segs[segs.length - 2] + '/' + one : '';
        if (byTail[one] === undefined) byTail[one] = p;
        if (two && byTail[two] === undefined) byTail[two] = p;
      }
    });

    function findPart(ref) {
      if (/^cid:/i.test(ref)) return byCid[ref.slice(4).toLowerCase()] || null;
      const abs = absLoc(ref, base);
      if (abs && byLoc[normLoc(abs)]) return byLoc[normLoc(abs)];
      if (byLoc[normLoc(ref)]) return byLoc[normLoc(ref)];
      const segs = normLoc(ref).split(/[\\/]/).filter(Boolean);
      if (!segs.length) return null;
      const one = segs[segs.length - 1];
      const two = segs.length > 1 ? segs[segs.length - 2] + '/' + one : '';
      return (two && byTail[two]) || byTail[one] || null;
    }

    let spent = 0;
    const cache = [];                                       // part -> data: URL | null
    const cached = [];
    function dataUrlFor(ref) {
      if (!ref || /^(data:|#|mailto:|tel:|javascript:)/i.test(ref)) return null;
      const part = findPart(ref);
      if (!part) return null;
      // Only what the page actually paints with. Word also links filelist.xml,
      // editdata.mso and themedata.thmx, which render nothing and would spend
      // the budget for no visible gain.
      if (!/^(image\/|text\/css$)/i.test(part.mimeType)) return null;
      const hit = cached.indexOf(part);
      if (hit !== -1) return cache[hit];
      let url = null;
      if (part.bytes.length <= MHT_INLINE_MAX && spent + part.bytes.length <= MHT_TOTAL_MAX) {
        spent += part.bytes.length;
        url = 'data:' + (part.mimeType || 'application/octet-stream') + ';base64,' +
          (part.base64 || bytesToBase64(part.bytes));
      }
      cached.push(part);
      cache.push(url);
      return url;
    }

    let out = String(pageHtml).replace(
      /\s(src|href|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (whole, attr, dq, sq, bare) => {
        const ref = dq !== undefined ? dq : (sq !== undefined ? sq : bare);
        const url = dataUrlFor(ref);
        if (url) return ' ' + attr + '="' + url + '"';
        // An unresolved href is a link (inert under sandbox=""); an unresolved
        // src is a subresource fetch, so it gets blanked.
        if (attr.toLowerCase() !== 'href' && !/^(data:|#)/i.test(ref)) return ' ' + attr + '=""';
        return whole;
      }
    );

    out = out.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (whole, quote, ref) => {
      const url = dataUrlFor(ref);
      if (url) return 'url("' + url + '")';
      // Word writes behavior:url(#default#VML) — internal, must survive.
      if (/^(https?:)?\/\//i.test(ref)) return 'url("")';
      return whole;
    });

    return retargetMetaCharset(stripActiveHtml(out));
  }

  // Inside a container this archive is one attachment among many, and the
  // container's renderer draws an attachment's pages with its *document*
  // renderer — which speaks {pageNum, blocks}, not {label, lines}. Rewriting
  // into that vocabulary (and re-pointing every child's pagesIndex) is what
  // keeps Docparse/index.html working untouched. A top-level .mht keeps the
  // email shape, whose pages[0].label === 'Web Page' routes it to
  // appendEmailPages instead.
  function emailPagesToDocPages(result) {
    const out = [];
    const remap = {};
    result.pages.forEach((page, i) => {
      remap[i] = out.length;
      if (page.lines) {
        out.push({ pageNum: out.length + 1, blocks: [{ lines: page.lines }], ocr: false });
      } else if (page.pages && page.pages.length && page.pages[0].blocks) {
        page.pages.forEach(p => out.push({ pageNum: out.length + 1, blocks: p.blocks, ocr: !!p.ocr }));
      } else {
        const lines = page.note ? [page.label, page.note] : [page.label];
        out.push({ pageNum: out.length + 1, blocks: [{ lines: lines }], ocr: false });
      }
    });
    result.attachments.forEach(d => {
      if (d.pagesIndex >= 0) d.pagesIndex = remap[d.pagesIndex];
    });
    result.pages = out;
  }

  async function processMht(file, notify, depth, opts) {
    // Nested, the email loop already owns the status line.
    if (!depth) notify('Opening web archive…');
    const archive = splitMhtParts(bytesToBinaryString(new Uint8Array(await file.arrayBuffer())));
    const parts = archive.parts;

    // The page itself is whatever the root points at, else the first HTML part.
    // Word writes neither root header; Chrome writes Snapshot-Content-Location.
    const rootLoc = normLoc(archive.rootHeaders['content-location'] ||
      archive.rootHeaders['snapshot-content-location'] || '');
    const htmlParts = parts.filter(p => p.mimeType === 'text/html' || p.mimeType === 'application/xhtml+xml');
    let htmlPart = null;
    if (rootLoc) htmlPart = htmlParts.filter(p => normLoc(p.location) === rootLoc)[0] || null;
    if (!htmlPart) htmlPart = htmlParts[0] || null;
    if (!htmlPart) throw new Error(`${MHT_BAD} there is no HTML page inside it.`);

    const pageHtml = decodeMimeText(htmlPart.bytes, htmlPart.charset);
    const previewHtml = buildMhtPreviewHtml(htmlPart, pageHtml, parts);

    // Text is taken from the original HTML, not the preview: the preview
    // carries megabytes of base64 that innerHTML would have to parse for
    // nothing. <style> and conditional comments go first — a Word page's style
    // block is thousands of characters of CSS that textContent would otherwise
    // hand back as document text.
    const textSource = stripActiveHtml(pageHtml)
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    const bodyText = stripHtmlToText(textSource).trim() || '(no page text)';

    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(pageHtml);
    const headerLines = [];
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
    if (title) headerLines.push('Title: ' + title);

    const nested = parts
      .filter(p => p !== htmlPart && isMhtDocumentPart(p))
      .map(p => ({
        fileName: mhtPartName(p),
        mimeType: p.mimeType,
        // No related/contentId here on purpose: isMhtDocumentPart has already
        // ruled on furniture, and a Content-ID would make isInlineFurniture
        // re-judge a genuine embedded PDF as a signature image.
        getContent: async () => p.bytes,
      }));

    const result = await processEmailAttachments(
      headerLines, bodyText.split('\n'), nested, notify, depth || 0, 'Web Page', opts
    );
    result.previewHtml = previewHtml;
    if (depth > 0) emailPagesToDocPages(result);
    return result;
  }

  // ---------- .msg / .eml: the email as it was SENT ----------
  //
  // stripHtmlToText throws the layout away, and for the TEXT pass that is
  // right: a price table reads as prose either way, and the cross-check only
  // ever wanted the words. It is the wrong answer for a reviewer. An email's
  // tables, its bold, and the company chop somebody pasted straight into the
  // body ARE the document, and the viewer had no way to show any of it --
  // previewKindFor('eml') is 'other', a filename and a download button. So the
  // HTML is kept as a second, render-only copy beside the text.
  //
  // Opt-in (`emailPreviewHtml`), the same rule markContext and markCrop follow:
  // `previewHtml` is part of parseFile's result, so an email growing one is a
  // visible output change and Docparse/index.html's two-argument call must not
  // see it.
  //
  // A cid: reference resolves against the email's OWN inline parts and nowhere
  // else -- the same problem .mht has with Content-Location, one layer further
  // in. data: URLs rather than blob:, for the reason buildMhtPreviewHtml
  // records: a sandbox="" iframe has an opaque origin and Chrome will not load
  // a blob: subresource into one.
  function normEmailCid(raw) {
    return String(raw || '').trim().replace(/^</, '').replace(/>$/, '').toLowerCase();
  }

  // Fresh each call on purpose. A module-level /g literal carries lastIndex
  // between the scan pass and the replace pass, which silently skips the first
  // reference of whichever pass runs second.
  function emailRefPattern() {
    return /\s(src|href|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  }

  // `parts` is deliberately NOT the descriptor list processEmailAttachments is
  // given. That list is read by isInlineFurniture, which treats any part
  // carrying a contentId as layout furniture -- so handing it the contentIds
  // this function needs would re-classify real attachments of every .msg,
  // which is an output change nobody asked for. Two lists over one shared one.
  async function buildEmailPreviewHtml(html, parts) {
    const src = String(html || '');
    if (!src.trim()) return '';

    const byCid = {};
    (parts || []).forEach(part => {
      const cid = normEmailCid(part.contentId);
      if (cid && byCid[cid] === undefined) byCid[cid] = part;
    });

    // Only the parts the page actually paints with, so an email with forty
    // attachments and one inline logo decodes one.
    const wanted = [];
    const scan = emailRefPattern();
    let m;
    while ((m = scan.exec(src)) !== null) {
      const ref = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
      if (!/^cid:/i.test(ref || '')) continue;
      const cid = normEmailCid(ref.slice(4));
      if (byCid[cid] && wanted.indexOf(cid) === -1) wanted.push(cid);
    }

    const urls = {};
    let spent = 0;
    for (const cid of wanted) {
      const part = byCid[cid];
      // Images only, same as buildMhtPreviewHtml: a linked .docx renders
      // nothing and would spend the budget for no visible gain.
      if (!/^image\//i.test(part.mimeType || '')) continue;
      let bytes;
      try {
        bytes = await part.getContent();
      } catch (e) {
        continue;                                 // one unreadable logo, not a failed email
      }
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      if (!u8.length || u8.length > MHT_INLINE_MAX || spent + u8.length > MHT_TOTAL_MAX) continue;
      spent += u8.length;
      urls[cid] = 'data:' + part.mimeType + ';base64,' + bytesToBase64(u8);
    }

    const out = src.replace(emailRefPattern(), (whole, attr, dq, sq, bare) => {
      const ref = dq !== undefined ? dq : (sq !== undefined ? sq : bare);
      if (!/^cid:/i.test(ref || '')) return whole;
      const hit = urls[normEmailCid(ref.slice(4))];
      if (hit) return ' ' + attr + '="' + hit + '"';
      // An unresolved cid: in an href is an inert link under sandbox=""; in a
      // src it is a fetch the sandbox will refuse anyway, and a broken-image
      // glyph says less than nothing.
      return attr.toLowerCase() === 'href' ? whole : ' ' + attr + '=""';
    });

    // stripActiveHtml also blanks every absolute src -- which in mail means the
    // tracking pixels and remote images Outlook itself blocks by default.
    return retargetMetaCharset(stripActiveHtml(out));
  }

  async function processMsg(file, notify, depth, opts) {
    // Nested, the container's own attachment loop owns the status line.
    if (!depth) notify('Opening email…');
    const buf = await file.arrayBuffer();
    const reader = new global.MsgReader(buf);
    const msg = reader.getFileData();

    const headerLines = [];
    if (msg.subject) headerLines.push('Subject: ' + msg.subject);
    const from = msg.senderEmail
      ? (msg.senderName ? `${msg.senderName} <${msg.senderEmail}>` : msg.senderEmail)
      : (msg.senderName || '');
    if (from) headerLines.push('From: ' + from);
    const recipients = (msg.recipients || []).map(r => {
      const addr = r.smtpAddress || r.email || '';
      return r.name ? (addr ? `${r.name} <${addr}>` : r.name) : addr;
    }).filter(Boolean);
    if (recipients.length) headerLines.push('To: ' + recipients.join('; '));
    const date = msg.messageDeliveryTime || msg.clientSubmitTime;
    if (date) headerLines.push('Date: ' + date);
    const bodyText = (msg.body && msg.body.trim()) || (msg.bodyHtml ? stripHtmlToText(msg.bodyHtml) : '') || '(no body text)';
    const bodyTextLines = bodyText.split('\n');

    const attachments = (msg.attachments || []).map((attMeta, i) => ({
      fileName: attMeta.fileName || attMeta.fileNameShort || `attachment_${i + 1}`,
      getContent: async () => reader.getAttachment(attMeta).content,
      // No mimeType: MsgReader exposes none. .msg attachments always carry a
      // filename, so extFor never needs the fallback here.
    }));

    // MsgReader's own names for the two things the preview needs and the parse
    // deliberately does not (see buildEmailPreviewHtml on why this is a second
    // list): pidContentId is what an <img src="cid:..."> in the body points at.
    const previewHtml = (opts && opts.emailPreviewHtml)
      ? await buildEmailPreviewHtml(msg.bodyHtml, (msg.attachments || []).map(attMeta => ({
          contentId: attMeta.pidContentId || '',
          mimeType: attMeta.attachMimeTag || '',
          getContent: async () => reader.getAttachment(attMeta).content,
        })))
      : '';

    const result = await processEmailAttachments(
      headerLines, bodyTextLines, attachments, notify, depth || 0, undefined, opts);
    if (previewHtml) result.previewHtml = previewHtml;
    if (depth > 0) emailPagesToDocPages(result);
    return result;
  }

  // ---------- .eml: standard MIME email, parsed with postal-mime. ----------
  function formatAddressList(addresses) {
    return (addresses || []).map(a => {
      if (a.group) return a.group.map(m => m.name ? `${m.name} <${m.address}>` : m.address).join(', ');
      return a.name ? `${a.name} <${a.address}>` : a.address;
    }).filter(Boolean).join('; ');
  }

  // postal-mime hands a part's content back as either a string (base64 or
  // raw) or bytes, so every reader of it needs this. Named rather than inlined
  // because the preview pass reads the same parts the parse pass does.
  function emlPartBytes(att) {
    if (typeof att.content === 'string') {
      return att.encoding === 'base64'
        ? Uint8Array.from(atob(att.content), c => c.charCodeAt(0))
        : new TextEncoder().encode(att.content);
    }
    return att.content;
  }

  async function processEml(file, notify, depth, opts) {
    if (!depth) notify('Opening email…');
    const buf = await file.arrayBuffer();
    const email = await global.PostalMime.parse(buf);

    const headerLines = [];
    if (email.subject) headerLines.push('Subject: ' + email.subject);
    if (email.from) headerLines.push('From: ' + formatAddressList([email.from]));
    if (email.to && email.to.length) headerLines.push('To: ' + formatAddressList(email.to));
    if (email.cc && email.cc.length) headerLines.push('Cc: ' + formatAddressList(email.cc));
    if (email.date) headerLines.push('Date: ' + email.date);
    const bodyText = (email.text && email.text.trim()) || (email.html ? stripHtmlToText(email.html) : '') || '(no body text)';
    const bodyTextLines = bodyText.split('\n');

    const attachments = (email.attachments || []).map((att, i) => ({
      fileName: att.filename || `attachment_${i + 1}`,
      // Carried so extFor has something to fall back on when the part has no
      // filename and the placeholder above kicks in.
      mimeType: att.mimeType || '',
      getContent: async () => emlPartBytes(att),
    }));

    const previewHtml = (opts && opts.emailPreviewHtml)
      ? await buildEmailPreviewHtml(email.html, (email.attachments || []).map(att => ({
          contentId: att.contentId || '',
          mimeType: att.mimeType || '',
          getContent: async () => emlPartBytes(att),
        })))
      : '';

    const result = await processEmailAttachments(
      headerLines, bodyTextLines, attachments, notify, depth || 0, undefined, opts);
    if (previewHtml) result.previewHtml = previewHtml;
    if (depth > 0) emailPagesToDocPages(result);
    return result;
  }

  // ---------- Public entry point ----------
  //
  // `opts` is optional and every field of it defaults to the behaviour that
  // existed before it did, so the two-argument call — which is the only call
  // Docparse/index.html makes — is unchanged:
  //
  //   deferOcr        don't recognize scanned pages now. They come back as
  //                   ocrPending entries with no blocks, so the cheap half of
  //                   the parse (containers, PDF text layers, workbooks, and
  //                   crucially the ink/signature pass) still lands in seconds
  //                   and the minutes-long part can be asked for later.
  //   retainForResume keep the original bytes of any document that ends up
  //                   with pending pages even when it is over the retention
  //                   cap — without the bytes that document can never be read
  //                   at all, which is a worse outcome than the cap prevents.
  //   inkBudgetMs     override the per-PDF ink budget (default INK_BUDGET_MS).
  //   ocrBudgetMs     bound this file's OCR the way an attachment inside a
  //                   container is bounded (see below). Omitted means unbounded,
  //                   which is what a two-argument call has always got.
  //   textAttachments read a plain-text file (TEXT_EXTS) as a document rather
  //                   than refusing it. Without it a .txt is `skipped` inside a
  //                   container and a throw on its own, which is what the App's
  //                   text preview had nothing to draw from.
  //   seedMarks       ink marks already known for this document, as a
  //                   { [pageNum]: marks } map, so a re-parse can skip the ink
  //                   pass it already paid for.
  //
  // inkBudgetMs and seedMarks exist for resumeDeferredOcr, which re-parses a
  // document it has already inspected once and passes them itself — a caller
  // never sets them by hand.
  //
  // `ocrBudgetMs` exists because the two budget-setting call sites are both on
  // the CONTAINER path (an email's attachment, and resumeDeferredOcr's per-doc
  // re-parse); a file handed straight to parseFile got `undefined` and therefore
  // no soft deadline AND no hard timeout. Measured: `L260390185MZ signed
  // contract.pdf` (22 scanned pages) ran to completion in 500s — past
  // ATTACHMENT_OCR_BUDGET_MS — with no cut-off and no "[Pages N-M not read]"
  // note, because there was nothing to cut it off.
  //
  // An opt rather than a default, per the compatibility rule in the root
  // CLAUDE.md: `Docparse/index.html` calls this with two arguments and a
  // deadline would change its output for exactly this document — a partial read
  // plus `truncated: true` where it used to get all 22 pages. Which of the two
  // is *better* differs by consumer: a human who dropped one file and is
  // watching it wants all of it, while a Process click waiting on four documents
  // cannot afford eight minutes on one. So the caller says.
  async function parseFile(file, onStatus, opts) {
    const notify = typeof onStatus === 'function' ? onStatus : function () {};
    const ext = extFor(file.name, file.type);
    const budget = opts && Number(opts.ocrBudgetMs) > 0 ? Number(opts.ocrBudgetMs) : 0;

    // Soft deadline and hard timeout together, exactly as the container path
    // pairs them: the deadline is checked between pages and preserves what has
    // been read, and the timeout is the backstop for a single page that hangs
    // past even the overrun the deadline tolerates.
    const parse = parseByExt(file, ext, notify, 0, budget ? Date.now() + budget : undefined, opts);
    const result = await (budget ? withTimeout(parse, budget + ATTACHMENT_HARD_BUFFER_MS) : parse);
    if (!result) throw new Error('Unsupported file type: .' + ext);

    // The user's own pick described exactly like an attachment, so a viewer can
    // show it with the same components. Its blob is the caller's own File —
    // nothing is copied. attachments is guaranteed present so every consumer
    // can iterate it without a per-format check.
    result.self = {
      fileName: file.name,
      ext,
      mimeType: file.type || '',
      size: file.size,
      blob: file,
      previewKind: previewKindFor(ext),
    };
    if (!result.attachments) result.attachments = [];
    return result;
  }

  global.DocparseEngine = {
    parseFile,
    // What one attachment's worth of OCR is allowed to cost, so a caller passing
    // `ocrBudgetMs` can ask for the same bound the container path applies instead
    // of copying the number. A constant, not behaviour: reading it cannot change
    // what a two-argument parseFile does.
    OCR_BUDGET_MS: ATTACHMENT_OCR_BUDGET_MS,
    // The other half of deferOcr: finishes a result parsed with it. Only
    // meaningful for an email/container result — a standalone file parsed with
    // deferOcr reports its pending pages but has no resume path.
    resumeDeferredOcr,
    extractFieldsFromBlocks,
    // The email's own render-only copy of itself, exposed because whether a
    // cid: image survives into the preview -- and whether a tracking pixel
    // does not -- is exactly what reading the code cannot settle. Pure over
    // {contentId, mimeType, getContent} descriptors: no MsgReader, no
    // postal-mime, no browser.
    buildEmailPreviewHtml,
    // Exposed for the label/field heuristics to be exercised on their own —
    // they are pure and need none of the browser libraries the rest of the
    // engine loads.
    canonicalizeLabel,
    canonicalizeFields,
    reconcileOcrFields,
    extractFieldsFromSheet,
    // The table half of field detection, and the ATQ cost table it feeds.
    // Pure functions over rows of strings — no PDF, no layout pass.
    fieldsFromTable,
    extractFieldsFromTables,
    parseAtqCostTable,
    atqRecordsFromTables,
    // The workbook half of the same pair. Needs the XLSX global, which loads
    // under Node too, so a real .xlsx can be checked without a browser.
    parseAtqWorkbook,
    // The roll-up rule that keeps one ATQ from being counted twice when an
    // email carries both the workbook and a PDF print of it.
    dedupeAtqRecords,
    // Filename matching only, so the real corpus's attachment names can be
    // run against real quotation references without opening a document.
    matchQuotationAttachments,
    // Ink inspection, exposed so it can be pointed at a single rendered page:
    // it takes ImageData and needs no PDF, no OCR and no network. `debug`
    // additionally returns every blob it measured, which is how its thresholds
    // were set from real signed and unsigned documents.
    analyzeInkImage,
    // The whole per-page path, render and text layer included, so it can be
    // pointed at one page of one PDF without running a parse.
    inspectPdfPage,
    // Which party each mark belongs to, read off the printed sign-off block.
    // Pure geometry and text over already-normalised boxes — no canvas, no
    // OCR, no PDF — so its column and cue rules are testable under plain Node,
    // which is the half of this that browser eyeballing is worst at checking.
    attachMarkContext,
    // Where a mark's own picture is cut from. Pure geometry over page
    // fractions, exported for the same reason: whether the rect reaches the
    // name above the ink and stops short of the counterparty's column is
    // exactly what a browser eyeball cannot check reliably, and a wrong column
    // looks identical to a right one.
    markCropRect,
    summarizeSigning,
    signingFields,
    // The plain-text list, exported for the same reason SHEET_EXTS is: the App
    // keeps its own VIEWER_TEXT_EXTS (which is WIDER -- it also carries the two
    // email extensions, which are containers rather than text files), and every
    // member of this one must be in it or a format the engine reads as text
    // would preview as an undisplayable 'other'.
    TEXT_EXTS,
    // The one spreadsheet list. Exported so the App's own previewKindForExt
    // can defer to it rather than keeping a second transcription that drifts.
    SHEET_EXTS,
    previewKindFor,
  };
  // globalThis rather than window, so the DOM-free half of the engine can also
  // be loaded under plain Node for testing. In a browser the two are the same
  // object, and Docparse/index.html keeps working from file:// unchanged.
})(typeof globalThis !== 'undefined' ? globalThis : window);
