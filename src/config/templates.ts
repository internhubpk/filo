// =============================================================================
// FILO FORMAL DOCUMENT TEMPLATES
// =============================================================================
// A small, pure registry of structured formal-document templates (letters,
// memos, fillable forms, invoices, quotations, minutes, agreements, notices).
//
// A template is NOT a file asset — it is a set of STRUCTURAL RULES that the
// generation pipeline injects at three points:
//   • design stage   → templateDesignContext()   (restrained formal design)
//   • planning stage → templatePlanningBlock()   (the document's fixed anatomy)
//   • content stage  → templateContentDirection() (per-section writing rules)
//
// The module deliberately imports NOTHING (not even types) so it can be used
// from BOTH runtimes: Next.js (client + server routes) and the Convex worker
// (../src/config/templates relative import).
// =============================================================================

export interface FormalTemplate {
  /** Stable id sent client → API → Convex job → prompts. */
  id: string
  /** Picker label ("Business Letter"). */
  label: string
  /** One-line picker description. */
  description: string
  /** Output formats this template makes sense for. */
  formats: Array<'docx' | 'pdf' | 'xlsx' | 'pptx'>
  /**
   * Injected into the PLANNING prompt: the document's fixed anatomy —
   * sections, their order, and what each must contain.
   */
  planning: string
  /**
   * Injected into the DESIGNER prompt: the visual direction a formal
   * document of this kind should follow (conservative, print-like).
   */
  design: string
  /**
   * Injected into every SECTION CONTENT prompt: how the section's
   * components must be shaped (tables for fill-ins, blank rules, no
   * decorative charts, …).
   */
  content: string
  /** Example prompt that pre-fills the composer when the chip is clicked. */
  starter: string
}

// Shared rule fragments -------------------------------------------------------

const NO_DECOR = `This is a FORMAL RECORD document: no cover page, no table of contents, no decorative charts or diagrams, no metric grids. Numbers appear only where the document type genuinely carries them.`

const FILLABLE_TABLE_RULES = `Every fill-in field must be a TABLE cell rendered with a bottom rule: keep label and blank SEPARATE ("Cell 1" = the label, "Cell 2" = an EMPTY string so the renderer draws a clean empty cell). Never print underscores "____" or "[field]" tokens. Checkboxes are written as "( ) " followed by the option text. Multi-line fill areas (address, remarks) are a table row whose second cell contains 3-4 empty lines rendered as empty table rows below the label row.`

// ---------------------------------------------------------------------------

export const FORMAL_TEMPLATES: FormalTemplate[] = [
  {
    id: 'formal-letter',
    label: 'Business Letter',
    description: 'Formal correspondence — letterhead, inside address, subject, salutation, closing.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — BUSINESS LETTER (block style). The plan must produce EXACTLY this anatomy, in order:
1. "Letterhead" — sender name, position, company, address lines, contact lines; centered or left block.
2. "Reference & Date" — reference number (if any) and full date, left-aligned.
3. "Inside Address" — recipient name, position, company, address block.
4. "Subject Line" — a bold "Subject:" line naming the matter precisely.
5. "Salutation" — "Dear Mr./Ms. …," (or "Dear Sir/Madam," when unnamed).
6. "Body" — 3-4 short paragraphs: opening states the purpose, middle develops it with facts, closing states the expected action or courtesy.
7. "Complimentary Close" — e.g. "Yours sincerely,".
8. "Signature Block" — sender name, position, company, contact.
9. Optional "Enclosures / CC" line(s) when the user's request implies attachments or copies.
Keep the whole letter on ONE page. 4-7 sections total; never add extra chapters, parts or appendix sections.`,
    design: `Conservative correspondence design: generous margins, single-column, serif or neutral sans body at 11pt, no strong accent color (thin rule under the letterhead at most).`,
    content: `Write as a formal letter, first person singular/plural as appropriate. No headings inside the body beyond the fixed letter anatomy; paragraphs are short (2-4 sentences). No lists, tables, charts or takeaways inside the letter body — prose only. British or American spelling must follow the user's own spelling. Keep tone courteous, precise, and free of marketing language.`,
    starter: 'Write a formal letter to the municipal corporation requesting a new trade license for our newly opened branch office.',
  },
  {
    id: 'memo',
    label: 'Memo',
    description: 'Internal memorandum — TO/FROM/DATE/SUBJECT block, purpose, action required.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — INTERNAL MEMORANDUM. The plan must produce EXACTLY this anatomy, in order:
1. "Memo Header" — a bordered/banded block: TO:, FROM:, DATE:, SUBJECT: (and CC: when relevant). Use a table for the block, labels bold in the left column.
2. "Purpose" — one short paragraph stating why the memo exists.
3. "Background" — 1-2 paragraphs of necessary context only.
4. "Discussion" — the substance: facts, options, implications. A small table is allowed ONLY if the user's request carries comparative data.
5. "Action Required" — who must do what by when; a short numbered list is appropriate here.
6. "Distribution & Filing" — distribution list and reference code (when provided by the user).
3-6 sections total. No cover, no contents page.`,
    design: `Plain administrative design: no cover, thin header rule, restrained single accent color, tight 11pt body.`,
    content: `Write in the clipped, factual house style of an internal memo: complete sentences, no rhetorical flourishes, no greetings or sign-offs. "Action Required" items each begin with an imperative verb and carry an owner and a deadline when the user's request provides one.`,
    starter: 'Draft an internal memo announcing the new hybrid work policy (3 office days per week) starting next quarter.',
  },
  {
    id: 'form',
    label: 'Fillable Form',
    description: 'Application / registration form — field tables, checkboxes, declaration, signatures.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — FILLABLE FORM (application / registration / admission / job form). The plan must produce EXACTLY this anatomy, in order:
1. "Form Header" — issuing organization, form title (e.g. "Application for Employment"), form/reference number, revision date.
2. "Instructions" — 2-4 lines telling the applicant how to complete the form (block capitals, supporting documents, where to submit).
3. "Section A — Personal Information" — field table: full name, father/spouse name, date of birth, CNIC/National ID, gender, nationality, marital status, contact number, email, present & permanent address. Field labels in the left column; EMPTY fill cells on the right.
4. "Section B — Application Details" — the position/class/program applied for, department/branch, preferred location — as a field table.
5. "Section C — Educational Background" — a 5-6 column table: level (Matric/Intermediate/Bachelors/Masters/Other), institution, board/university, year, marks/grade/percentage, with 4-5 EMPTY data rows the applicant fills in.
6. "Section D — Experience / Supporting Details" — organization, designation, from–to dates table with empty rows (skip for academic forms; adjust to the user's request).
7. "Section E — Declaration & Signatures" — a short pre-printed declaration paragraph, then a signature table: applicant signature/date, for official use, witness — each cell EMPTY.
Adapt section names to whatever the user actually asked for (job, admission, membership, bank account…), but KEEP the section-letter structure, field tables with EMPTY fill cells, and the declaration + signature block. 5-7 sections. No cover, no table of contents, no charts.`,
    design: `Institutional form design: bold section-letter headings with a thin rule, dense but airy tables, generous white space inside fill cells so handwriting fits, no decorative elements.`,
    content: `${FILLABLE_TABLE_RULES} Section content is a sequence of "heading" + "table" components. Pre-printed text (instructions, declaration) stays short and formal. Where the user's request names specific fields, use EXACTLY those fields; never invent eligibility criteria or requirement lists that contradict the request.`,
    starter: 'Create a job application form for the position of Secondary School Teacher with personal info, qualifications, experience and a declaration section.',
  },
  {
    id: 'invoice',
    label: 'Invoice',
    description: 'Billing document — parties, line items, totals, payment terms.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — INVOICE. The plan must produce EXACTLY this anatomy, in order:
1. "Invoice Header" — issuer name/address/contact, the word "INVOICE" prominent, invoice number, issue date, due date.
2. "Billed By / Billed To" — a two-column table: issuer details left, client details right (names, addresses, tax IDs when provided).
3. "Line Items" — a table with columns: #, Description, Quantity, Unit Price, Amount. Amount cells are formulas (Quantity × Unit Price) when the format supports it; use the real figures from the user's request.
4. "Summary" — subtotal, tax/VAT % and amount when applicable, deductions/discount when applicable, TOTAL DUE — bold. Values MUST match the line items exactly.
5. "Payment Terms & Details" — due terms (e.g. Net 15), accepted methods, bank/account details when provided, late-fee note when the request implies one.
6. "Notes" — thank-you line and any special instructions from the user's request.
When the user's request does not supply real figures, use clearly realistic placeholder amounts consistent with the described services. 4-6 sections. No cover, no charts.`,
    design: `Clean commercial design: strong header band in a single brand color, generous table padding, totals emphasized with weight and a top/bottom double rule, right-aligned numeric columns.`,
    content: `Numbers must be internally consistent: Amount = Quantity × Unit Price per row; Summary total = subtotal + tax − discount. Currency matches the user's request (default USD). Numeric cells are plain numbers (no currency symbols inside table cells when a currency label exists in the header/terms). Keep descriptions service-like and specific to the user's request.`,
    starter: 'Create an invoice from DevStudio to Acme Corp for website design (40 hours at $85) and 3 months of support at $500 per month, with 5% withholding tax.',
  },
  {
    id: 'quotation',
    label: 'Quotation / PO',
    description: 'Price quotation or purchase order — items, pricing, validity, acceptance.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — QUOTATION / PURCHASE ORDER. The plan must produce EXACTLY this anatomy, in order:
1. "Quotation Header" — issuer block, document title (QUOTATION or PURCHASE ORDER), quote/PO number, date, validity date.
2. "Supplier / Customer" — two-column details table.
3. "Items & Pricing" — table: #, Item/Service description, Quantity, Unit, Unit Price, Total. Real figures from the request; formulas where the format supports them.
4. "Commercial Terms" — delivery/lead time, warranty, taxes, freight, payment terms — as a compact 2-column terms table or short paragraphs.
5. "Total & Validity" — grand total bold; statement that the quotation is valid until the validity date.
6. "Acceptance" — an acceptance block the customer signs: "We accept the above quotation", name/signature/date cells left EMPTY, plus any "For <issuer>" counter-signature line.
4-6 sections. No cover, no charts.`,
    design: `Commercial design like the invoice family: single brand color, tidy pricing table, right-aligned numbers, acceptance block visually separated with a rule.`,
    content: `Same numeric-consistency rules as an invoice (row totals and grand total must add up). Commercial terms must be concrete and unambiguous. The acceptance block ships EMPTY cells for signatures — never pre-sign anything.`,
    starter: 'Prepare a quotation from Brightline Printers to City School for 500 brochures A4 full color at $1.20 each and 200 posters at $2.50 each, valid for 30 days.',
  },
  {
    id: 'meeting-minutes',
    label: 'Meeting Minutes',
    description: 'Formal minutes — attendance, agenda, discussions, action items, next meeting.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — MEETING MINUTES. The plan must produce EXACTLY this anatomy, in order:
1. "Minutes Header" — organization/body name, meeting title, date, time, venue, minutes-taker — as a labeled field table.
2. "Attendance" — present members table/list (name + role), then absent-with-apology and guests; leave NAME cells EMPTY when the user did not name attendees.
3. "Agenda & Discussions" — one numbered item per agenda point: the item as a heading, a 2-4 sentence record of the discussion, and the decision/outcome ("RESOLVED: …") when one was taken.
4. "Action Items" — a table: #, action, owner, due date, status — real items from the user's request, else empty rows to fill in later.
5. "Next Meeting & Adjournment" — proposed date/time and closing note.
6. "Signatures" — prepared-by / approved-by signature table with EMPTY cells.
4-6 sections. No cover, no charts.`,
    design: `Official-records design: restrained header block, numbered agenda headings, tables with clean rules, no decorative color beyond one accent.`,
    content: `Minutes are written in past tense, third person, recorded neutrally — never editorialize. Decisions use the word "RESOLVED". Assignments always name an owner and a date when the source request provides them; otherwise leave fill cells EMPTY instead of inventing names.`,
    starter: 'Write minutes for the monthly project steering committee meeting reviewing the construction timeline delay and budget revision.',
  },
  {
    id: 'agreement',
    label: 'Agreement / NDA',
    description: 'Legal agreement — parties, recitals, numbered clauses, signatures.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — LEGAL AGREEMENT (contract / NDA / service agreement). The plan must produce EXACTLY this anatomy, in order:
1. "Title & Parties" — the agreement title, then a parties block naming each party with address and registration details ("Party 1 / Party 2" when the user did not give names), and the effective date.
2. "Recitals" — 2-4 "WHEREAS …" clauses stating the background.
3. "Definitions" — the key defined terms used later (only the ones the document actually uses).
4. "Operative Clauses" — numbered clauses 1., 2., 3. … each as its own section: obligations, term & duration, consideration/payment, confidentiality, intellectual property, termination, dispute resolution & governing law, miscellaneous (entire agreement, amendments, notices, counterparts). Include ONLY the clause families relevant to the user's request — mark their numbers cleanly.
5. "Execution / Signature Blocks" — "IN WITNESS WHEREOF …" line, then a two-column signature table (party name, signature, name, title, date) with EMPTY cells.
Add a "Schedule/Annexure" section only when the user's request describes one (e.g. a rate schedule table). 5-9 sections. No cover, no charts.`,
    design: `Legal-design: serif body, justified text, clause numbers in the heading, single conservative ink color, signature block pushed to a clean bordered table.`,
    content: `Write in formal legal register — "shall", defined terms in quotes — but keep sentences readable. Never fabricate jurisdiction-specific statutory citations; keep governing-law clauses generic ("the laws of the jurisdiction agreed by the parties") unless the user named one. Payment figures and durations come from the user's request only. Signature cells remain EMPTY.`,
    starter: 'Draft a mutual non-disclosure agreement between a software agency and a fintech client, valid for 3 years with standard confidentiality clauses.',
  },
  {
    id: 'notice',
    label: 'Notice / Circular',
    description: 'Official notice — letterhead, circular number, subject, body, distribution.',
    formats: ['docx', 'pdf'],
    planning: `TEMPLATE — OFFICIAL NOTICE / CIRCULAR. The plan must produce EXACTLY this anatomy, in order:
1. "Letterhead" — issuing body name, address, contact, logo placeholder line (text only).
2. "Circular Reference" — circular/notice number and date of issue.
3. "Addressees" — "To: All …" distribution line.
4. "Subject" — bold subject line stating the matter.
5. "Body" — 2-4 short paragraphs announcing the decision/notice with effective date(s); include a compact details table ONLY when the request carries dates, timings or amounts per category.
6. "Authorization" — "By order of …" plus the authorizing officer's name, designation and signature cell (EMPTY).
7. "Distribution List" — cc/forward list when the request implies one.
3-6 sections. No cover, no charts.`,
    design: `Government/institutional notice design: centered letterhead, thin double rule, bold subject, restrained layout.`,
    content: `Authoritative, impersonal register ("This is to inform…", "All concerned are advised…"). Effective dates are prominent. Do not invent penalties, deadlines or policy details beyond what the request supports.`,
    starter: 'Issue an official circular notifying all departments of the revised office timings during Ramadan (9am to 3pm).',
  },
]

export const DEFAULT_TEMPLATE_ID = 'none'

export const TEMPLATE_IDS: Set<string> = new Set(FORMAL_TEMPLATES.map((t) => t.id))

/** Resolve a template id (client/API/DB value) to its definition, or null. */
export function getTemplate(id?: string | null): FormalTemplate | null {
  if (!id) return null
  return FORMAL_TEMPLATES.find((t) => t.id === id) ?? null
}

/** Server-side validation: keep only known template ids (or undefined). */
export function sanitizeTemplateId(id?: string | null): string | undefined {
  return id && TEMPLATE_IDS.has(id) ? id : undefined
}

/** Block appended to the PLANNING system prompt (empty when no template). */
export function templatePlanningBlock(id?: string | null): string {
  const t = getTemplate(id)
  return t ? `\n\n${t.planning}\n` : ''
}

/** Extra user-prompt paragraph for the DESIGNER stage (empty when none). */
export function templateDesignContext(id?: string | null): string {
  const t = getTemplate(id)
  if (!t) return ''
  return `The user picked the "${t.label}" formal template. Honor this design direction: ${t.design}`
}

/** Direction merged into every SECTION CONTENT prompt (empty when none). */
export function templateContentDirection(id?: string | null): string {
  const t = getTemplate(id)
  return t ? `${t.content} ${NO_DECOR}` : ''
}

/**
 * Whether this template turns the document into a short formal record —
 * used to cap the document scale (no 20-section letters).
 */
export function templateCapsScale(id?: string | null): boolean {
  return Boolean(getTemplate(id))
}
