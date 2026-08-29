// =============================================================================
// END-TO-END artifact pipeline test runner.
//
// Drives the REAL pipeline against a running Next.js server + local Convex
// backend + mock LLM + mock S3:
//   signup → plan upgrade → POST /api/artifacts/agent-generate (per format)
//   → poll job state via Convex (records every transition + timing)
//   → download the artifact via /api/artifacts/download (presigned URL)
//   → DEEP-validate the actual file bytes (unzip / parse / extract text)
//   → verify database state (job 100%, artifact + version + file rows)
//
// Usage: node tests/artifact-e2e/run-e2e.js [--formats DOCX,PDF,...] [--base http://localhost:3000]
// =============================================================================
const fs = require('fs');
const path = require('path');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const CONVEX_URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || 'http://127.0.0.1:3210';
const SERVER_SECRET = process.env.FILO_SERVER_SECRET || 'e2e-test-secret-0123456789abcdef';

const ALL_FORMATS = ['DOCX', 'PDF', 'XLSX', 'PPTX', 'CSV'];
const args = process.argv.slice(2);
const fmtIdx = args.indexOf('--formats');
const FORMATS = fmtIdx >= 0 ? args[fmtIdx + 1].split(',') : ALL_FORMATS;
// Simulate the browser render fallback nudge (ActiveGenerations)?
const nudgeIdx = args.indexOf('--no-nudge');
const NUDGE = nudgeIdx < 0;

// ---------- Convex client (from the app's own node_modules) ----------
const api = require(path.join(__dirname, '../../convex/_generated/api.js')).api;
let ConvexHttpClient; // resolved via dynamic import (convex is ESM-only)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function apiPost(pathname, body, token) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function apiGet(pathname, token) {
  const res = await fetch(BASE + pathname, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res;
}

// ---------- deep validators per format ----------
const JSZip = require(path.join(__dirname, '../../node_modules/jszip'));

async function validateOOXML(buf, kind, checks) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    check(`${kind}: zip container is readable`, false, String(e));
    return;
  }
  check(`${kind}: zip container is readable`, true);
  const required = {
    DOCX: ['word/document.xml', '[Content_Types].xml'],
    XLSX: ['xl/workbook.xml', '[Content_Types].xml'],
    PPTX: ['ppt/presentation.xml', '[Content_Types].xml'],
  }[kind];
  for (const part of required) {
    check(`${kind}: contains ${part}`, Boolean(zip.files[part]));
  }
  if (kind === 'DOCX') {
    const doc = await zip.files['word/document.xml'].async('string');
    check('DOCX: document.xml is non-trivial', doc.length > 2000, `${doc.length} chars`);
    check('DOCX: contains heading structure', doc.includes('Heading1'));
    check('DOCX: contains table markup', doc.includes('<w:tbl>'));
    check('DOCX: contains header/footer parts', Boolean(zip.files['word/header1.xml']) && Boolean(zip.files['word/footer1.xml']));
    check('DOCX: footer has PAGE field', (await zip.files['word/footer1.xml'].async('string')).includes('PAGE'));
    check('DOCX: no literal "undefined" text leaked', !doc.includes('>undefined<'));
    checks.docText = doc.replace(/<[^>]+>/g, ' ');
  }
  if (kind === 'XLSX') {
    const ExcelJS = require(path.join(__dirname, '../../node_modules/exceljs'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    check('XLSX: reopens in ExcelJS', true);
    check('XLSX: Overview sheet exists', Boolean(wb.getWorksheet('Overview')));
    const sheetCount = wb.worksheets.length;
    check('XLSX: one sheet per section + overview', sheetCount >= 4, `sheets=${sheetCount}`);
    const dataSheet = wb.worksheets.find((w) => w.name !== 'Overview');
    if (dataSheet) {
      let formulaCount = 0;
      let numberCount = 0;
      dataSheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.formula) formulaCount++;
          if (cell.type === ExcelJS.ValueType.Number) numberCount++;
        });
      });
      check('XLSX: contains REAL formulas', formulaCount >= 3, `formulas=${formulaCount}`);
      check('XLSX: numeric cells typed as numbers', numberCount >= 6, `numbers=${numberCount}`);
      check('XLSX: freeze pane set', Boolean(dataSheet.views && dataSheet.views.some((v) => v.state === 'frozen')));
      check('XLSX: autofilter set', Boolean(dataSheet.autoFilter));
      // Validate formulas have no obvious #REF! patterns (they are stored as
      // formula strings; a broken remap would reference wrong rows — we check
      // the remapped formula text explicitly).
      const formulas = [];
      dataSheet.eachRow((row) => row.eachCell((cell) => { if (cell.formula) formulas.push(cell.formula); }));
      checks.xlsxFormulas = formulas;
      const remapOk = formulas.every((f) => !/#REF/.test(f));
      check('XLSX: no #REF! in stored formulas', remapOk, formulas.slice(0, 4).join(' | '));
    }
  }
  if (kind === 'PPTX') {
    const presXml = await zip.files['ppt/presentation.xml'].async('string');
    check('PPTX: presentation.xml present', Boolean(presXml));
    const sizeMatch = /sldSz[^/]*cx="(\d+)"[^/]*cy="(\d+)"/.exec(presXml);
    check('PPTX: 16:9 slide dimensions', Boolean(sizeMatch), presXml.match(/sldSz[^/]*/)?.[0]);
    if (sizeMatch) {
      const [_, cx, cy] = sizeMatch.map(Number);
      check('PPTX: aspect ratio ≈ 16:9', Math.abs(cx / cy - 16 / 9) < 0.02, `${cx}x${cy}`);
    }
    const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    check('PPTX: multiple slides', slideFiles.length >= 5, `slides=${slideFiles.length}`);
    let allText = '';
    for (const f of slideFiles) allText += (await zip.files[f].async('string')).replace(/<[^>]+>/g, ' ');
    checks.pptxText = allText;
    check('PPTX: slides contain text content', allText.replace(/\s+/g, '').length > 200);
    // Every shape offset must be inside the slide bounds (EMU)
    const sldSz = { cx: Number(sizeMatch?.[1] || 0), cy: Number(sizeMatch?.[2] || 0) };
    let outOfBounds = 0;
    let inBoundsChecked = 0;
    for (const f of slideFiles) {
      const xml = await zip.files[f].async('string');
      const offs = xml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g);
      for (const m of offs) {
        const [x, y, cx, cy] = m.slice(1).map(Number);
        inBoundsChecked++;
        if (x < -10000 || y < -10000 || x + cx > sldSz.cx + 10000 || y + cy > sldSz.cy + 10000) outOfBounds++;
      }
    }
    check('PPTX: no shapes outside slide bounds', outOfBounds === 0, `${outOfBounds}/${inBoundsChecked} out of bounds`);
    const notesFiles = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
    check('PPTX: speaker notes present', notesFiles.length >= 1, `notes=${notesFiles.length}`);
  }
}

async function validatePdf(buf, checks) {
  check('PDF: %PDF signature', buf.slice(0, 5).toString() === '%PDF-');
  const text = buf.toString('latin1');
  check('PDF: has %%EOF trailer', text.includes('%%EOF'));
  // Extract text with unpdf to verify real, visible content
  try {
    const { extractText, getDocumentProxy } = await import(
      path.join(__dirname, '../../node_modules/unpdf/dist/index.mjs')
    );
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text: extracted, totalPages } = await extractText(pdf, { mergePages: false });
    check('PDF: page count ≥ 4', totalPages >= 4, `pages=${totalPages}`);
    const allText = (Array.isArray(extracted) ? extracted.join('\n') : extracted).replace(/\s+/g, ' ');
    checks.pdfText = allText;
    check('PDF: extractable text is substantial', allText.length > 500, `${allText.length} chars`);
    check('PDF: contains section content', /Executive Summary|Performance Analysis|Detailed Results/.test(allText));
    check('PDF: contains chart caption (chart rendered)', /Revenue by Month/.test(allText));
    // NO BLANK PAGES: every rendered page must carry extractable text. The
    // classic pdfkit defect (footer stamped below maxY → auto-pagination)
    // manifests exactly as blank pages holding only a page number.
    const pages = Array.isArray(extracted) ? extracted : [extracted];
    const blank = pages.map((t, i) => [i + 1, String(t || '').replace(/\s+/g, '').length]).filter(([, n]) => n < 5);
    check('PDF: no blank pages', blank.length === 0, blank.map(([p]) => `page ${p}`).join(', '));
  } catch (e) {
    check('PDF: text extraction works', false, String(e).slice(0, 120));
  }
}

function validateCsv(buf) {
  const text = buf.toString('utf-8').replace(/^\uFEFF/, '');
  check('CSV: UTF-8 BOM present', buf.slice(0, 3).toString('hex') === 'efbbbf');
  const lines = text.split(/\r\n/).filter((l) => l.length > 0);
  check('CSV: has header + data rows', lines.length >= 4, `rows=${lines.length}`);
  // RFC4180-aware parse
  const rows = lines.map((line) => {
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
  const colCount = rows[0].length;
  const ragged = rows.filter((r) => r.length !== colCount).length;
  check('CSV: consistent column count across rows', ragged === 0, `${ragged} ragged rows of ${rows.length}`);
  check('CSV: expected headers', /Item/.test(rows[0].join('|')));
  check('CSV: no markdown contamination', !rows.some((r) => r.some((c) => /^\s*\|/.test(c))));
}

// ---------- per-format E2E ----------
async function runFormat(convex, user, token, format) {
  console.log(`\n=== ${format} ===`);
  const t0 = Date.now();

  const gen = await apiPost('/api/artifacts/agent-generate', {
    prompt: `Create a ${format} for the E2E suite covering revenue by region, quarterly trends, and a roadmap. Include tables, metrics and a chart.`,
    artifactType: format === 'PPTX' ? 'presentation' : format === 'XLSX' || format === 'CSV' ? 'spreadsheet' : 'document',
    outputFormat: format,
  }, token);

  check(`${format}: agent-generate accepted`, gen.status === 200 && gen.json?.success, JSON.stringify(gen.json).slice(0, 200));
  if (!gen.json?.data?.jobId) return;
  const jobId = gen.json.data.jobId;

  // Poll job state; record transitions.
  const transitions = [];
  let lastStatus = '';
  let lastProgress = -1;
  const deadline = Date.now() + (NUDGE ? 240_000 : 120_000);
  let finalJob = null;
  while (Date.now() < deadline) {
    const job = await convex.query(api.generation.getJob, { jobId, userId: user.id });
    if (!job) { check(`${format}: job exists`, false, 'job row vanished'); return; }
    if (job.status !== lastStatus || job.progress !== lastProgress) {
      transitions.push({ t: Date.now() - t0, status: job.status, progress: job.progress, stage: job.currentStage, error: job.error || undefined });
      lastStatus = job.status;
      lastProgress = job.progress;
    }
    // Simulated browser fallback nudge (what ActiveGenerations does every 15s).
    if (NUDGE && job.status === 'rendering' && Date.now() - (job.updatedAt ?? 0) > 20_000) {
      await apiPost('/api/generation/render', { jobId }, token).catch(() => {});
    }
    if (['completed', 'failed', 'cancelled'].includes(job.status)) { finalJob = job; break; }
    await sleep(2000);
  }

  const renderingMs = (() => {
    const enter = transitions.find((tr) => tr.status === 'rendering');
    const done = transitions.find((tr) => ['completed', 'failed'].includes(tr.status));
    if (!enter) return -1;
    return (done ? done.t : Date.now() - t0) - enter.t;
  })();
  console.log(`  timeline: ${transitions.map((tr) => `${tr.status}@${tr.progress}%+${(tr.t / 1000).toFixed(0)}s`).join(' → ')}`);

  if (!finalJob) {
    check(`${format}: job reached a terminal state`, false, `still ${lastStatus} after ${Math.round((Date.now() - t0) / 1000)}s (stall!)`);
    return;
  }
  check(`${format}: job completed`, finalJob.status === 'completed', finalJob.error || '');
  check(`${format}: progress is an honest 100`, finalJob.progress === 100, `progress=${finalJob.progress}`);
  check(`${format}: artifactId attached`, Boolean(finalJob.artifactId));
  // NOTE: when the pipeline is fast the 2s poller may never OBSERVE the
  // intermediate "rendering" state — that's a pass, not a failure. Only
  // fail if we saw rendering AND it took absurdly long (>120s).
  check(`${format}: rendering phase took a reasonable time`, renderingMs < 120_000, `rendering took ${(renderingMs / 1000).toFixed(1)}s`);
  if (finalJob.status !== 'completed' || !finalJob.artifactId) return;

  // ---- DB state checks ----
  const artifact = await convex.query(api.artifacts.getArtifactForUser, { artifactId: finalJob.artifactId, userId: user.id });
  check(`${format}: artifact row exists`, Boolean(artifact));
  check(`${format}: artifact format matches`, artifact?.format === format, artifact?.format);
  check(`${format}: artifact has fileId`, Boolean(artifact?.fileId));
  const versionsRes = await convex.query(api.artifacts.listArtifactVersions, { artifactId: finalJob.artifactId, userId: user.id });
  const versions = versionsRes?.versions;
  check(`${format}: version row recorded`, Array.isArray(versions) && versions.length >= 1, `versions=${versions?.length}`);

  // ---- Download via the real API ----
  const dl = await apiGet(`/api/artifacts/download?id=${finalJob.artifactId}`, token);
  const dlJson = await dl.json().catch(() => null);
  const downloadUrl = dlJson?.data?.url || dlJson?.url;
  check(`${format}: download endpoint answers`, dl.status === 200 && downloadUrl, JSON.stringify(dlJson).slice(0, 140));
  if (!downloadUrl) return;
  const fileRes = await fetch(downloadUrl);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  check(`${format}: file downloads from storage`, fileRes.status === 200 && buf.length > 0);
  console.log(`  file: ${buf.length} bytes`);

  // ---- Deep file validation ----
  const checks = {};
  if (format === 'DOCX' || format === 'XLSX' || format === 'PPTX') await validateOOXML(buf, format, checks);
  if (format === 'PDF') await validatePdf(buf, checks);
  if (format === 'CSV') validateCsv(buf);

  // ---- content sanity ----
  if (format === 'DOCX' && checks.docText) {
    check('DOCX: section titles present', /Executive Summary|Performance Analysis|Detailed Results/.test(checks.docText));
    check('DOCX: metric values present', /3,731|405/.test(checks.docText));
  }
  if (format === 'PPTX' && checks.pptxText) {
    check('PPTX: metric slide content present', /405|3\.7K/.test(checks.pptxText));
  }
  if (format === 'XLSX' && checks.xlsxFormulas) {
    check('XLSX: formula remap targets real rows', checks.xlsxFormulas.some((f) => /\d{2,}/.test(f)), checks.xlsxFormulas.slice(0, 3).join(' | '));
  }
}

async function main() {
  ({ ConvexHttpClient } = await import('convex/browser'));
  console.log(`E2E against ${BASE} (convex ${CONVEX_URL}), formats=${FORMATS.join(',')}, nudge=${NUDGE}`);
  const convex = new ConvexHttpClient(CONVEX_URL);

  // 1. signup
  const email = `e2e-${Date.now()}@example.com`;
  const su = await apiPost('/api/auth/signup', { name: 'E2E Tester', email, password: 'e2e-password-123' });
  check('signup works', su.status === 200 && su.json?.success && su.json?.data?.sessionToken, JSON.stringify(su.json).slice(0, 160));
  if (!su.json?.data?.sessionToken) process.exit(1);
  const token = su.json.data.sessionToken;
  const user = su.json.data.user;

  // 2. upgrade to a plan with AI enabled (free plan blocks AI generation)
  const plans = await convex.query(api.plans.getAllPlans, {});
  const pro = (plans || []).find((p) => p.tier === 'pro') || (plans || []).find((p) => p.aiChatEnabled);
  if (pro) {
    await convex.mutation(api.users.updateUser, { userId: user.id, planId: pro._id });
    console.log(`user ${user.id} upgraded to plan ${pro.name || pro.tier}`);
  }

  // 3. per-format full-pipeline runs
  for (const format of FORMATS) {
    try {
      await runFormat(convex, user, token, format);
    } catch (e) {
      failed++;
      failures.push(`${format}: runner crashed — ${e.stack || e}`);
      console.log(`  ✘ runner crashed: ${e.stack || e}`);
    }
  }

  console.log(`\n================ RESULTS: ${passed} passed, ${failed} failed ================`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
