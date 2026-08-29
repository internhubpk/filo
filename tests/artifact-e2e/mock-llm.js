// =============================================================================
// Mock OpenAI-compatible LLM for artifact-pipeline E2E tests.
// Serves POST /v1/chat/completions and classifies each request by the system
// prompt the pipeline sends (designer / architect / content generator), then
// answers with deterministic, VALID JSON for that stage.
// =============================================================================
const http = require('http');

const PORT = Number(process.env.MOCK_LLM_PORT || 9401);

function designPlan(format) {
  const themeByFormat = { PPTX: 'corporate', XLSX: 'financial', CSV: 'financial' };
  return {
    artifactType: format === 'PPTX' ? 'presentation' : format === 'XLSX' || format === 'CSV' ? 'spreadsheet' : 'document',
    documentSubtype: 'e2e_test_artifact',
    audience: 'operations leadership',
    purpose: 'inform',
    tone: 'professional',
    contentDepth: 'standard',
    theme: themeByFormat[format] || 'executive',
    themeRationale: 'Deterministic E2E default matched to the output format.',
    density: format === 'PPTX' ? 'light' : 'medium',
    visualPriority: ['section hierarchy', 'readable typography'],
    accentOverride: null,
    useCharts: format !== 'CSV',
    useTables: true,
    useMetrics: true,
  };
}

function blueprint(format) {
  const isDeck = format === 'PPTX';
  const isSheet = format === 'XLSX' || format === 'CSV';
  const mkComp = (type, note, i) => ({ id: `comp-${type}-${i}`, type, order: i, content: null, note });
  const sections = [];
  const push = (type, title, comps) => {
    const idx = sections.length;
    sections.push({
      id: `sec-${idx}-${type}`,
      type,
      title,
      order: idx,
      components: comps.map((c, i) => mkComp(c, `${c} for ${title}`, i)),
    });
  };

  if (isDeck) {
    push('cover', 'E2E Quarterly Review', ['paragraph']);
    push('heading', 'Performance Highlights', ['list', 'metric_grid']);
    push('content', 'Revenue Trend', ['chart', 'paragraph']);
    push('table', 'Regional Breakdown', ['table']);
    push('heading', 'Closing Summary', ['key_takeaways']);
  } else if (isSheet) {
    push('content', 'Revenue Data', ['table', 'paragraph']);
    push('content', 'Cost Breakdown', ['table', 'paragraph']);
    push('content', 'Summary Metrics', ['metric_grid', 'list']);
  } else {
    push('cover', 'E2E Operations Report', ['paragraph']);
    push('content', 'Executive Summary', ['paragraph', 'key_takeaways', 'metric_grid']);
    push('content', 'Performance Analysis', ['heading', 'paragraph', 'chart', 'list']);
    push('table', 'Detailed Results', ['table', 'callout']);
    push('content', 'Roadmap & Recommendations', ['timeline', 'two_column', 'quote']);
    push('appendix', 'Appendix: Methodology', ['paragraph', 'list']);
  }
  return {
    title: format === 'PPTX' ? 'E2E Quarterly Review Deck' : format === 'XLSX' ? 'E2E Financial Workbook' : format === 'CSV' ? 'E2E Data Export' : 'E2E Operations Report',
    description: 'Deterministic end-to-end test artifact.',
    sections,
  };
}

const sentence = (topic, n) =>
  Array.from({ length: n }, (_, i) =>
    `Sentence ${i + 1} of the ${topic} section verifies that generated prose flows correctly and wraps predictably across renderers without truncation or clipping.`
  ).join(' ');

function tableData(fmt, withFormulas) {
  const header = ['Item', 'Region', 'Units', 'Unit Price', 'Revenue'];
  const rows = [
    header,
    ['Widgets', 'North', 120, 9.5, withFormulas ? '=C2*D2' : 1140],
    ['Gadgets', 'South', 85, 12.25, withFormulas ? '=C3*D3' : 1041.25],
    ['Gizmos', 'East', 200, 7.75, withFormulas ? '=C4*D4' : 1550],
    ['Total', '', withFormulas ? '=SUM(C2:C4)' : 405, '', withFormulas ? '=SUM(E2:E4)' : 3731.25],
  ];
  return rows;
}

function contentFor(format, sectionTitle) {
  const comps = [];
  if (format === 'XLSX' || format === 'CSV') {
    comps.push({ type: 'table', content: tableData(format, format === 'XLSX') });
    comps.push({ type: 'paragraph', content: sentence(sectionTitle, 3) });
    if (format === 'XLSX') {
      comps.push({
        type: 'metric_grid',
        content: [
          { label: 'Total Revenue', value: '$3,731', change: '+12% QoQ', unit: 'USD' },
          { label: 'Units Sold', value: '405', change: '+8% QoQ' },
        ],
      });
      comps.push({ type: 'list', content: ['Revenue grew across all regions', 'Cost per unit held steady', 'Volume is the primary growth driver'] });
    }
    return { components: comps };
  }
  if (format === 'PPTX') {
    if (/cover/i.test(sectionTitle)) {
      comps.push({ type: 'paragraph', content: sentence('deck cover', 2) });
    } else if (/Highlights/i.test(sectionTitle)) {
      comps.push({
        type: 'list',
        content: ['Units up 8% quarter over quarter', 'North region leads revenue growth', 'Two new enterprise accounts signed', 'Churn held below 2%'],
      });
      comps.push({
        type: 'metric_grid',
        content: [
          { label: 'Revenue', value: '$3.7K', change: '+12% QoQ' },
          { label: 'Units', value: '405', change: '+8% QoQ' },
          { label: 'Margin', value: '34%', change: '+2 pts' },
        ],
      });
    } else if (/Trend/i.test(sectionTitle)) {
      comps.push({
        type: 'chart',
        content: { chartType: 'line', title: 'Monthly Units', categories: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Units', data: [110, 140, 155] }], note: 'Monthly unit volume.' },
      });
      comps.push({ type: 'paragraph', content: sentence('trend', 2) });
    } else if (/Breakdown/i.test(sectionTitle)) {
      comps.push({ type: 'table', content: tableData('PPTX', false) });
    } else {
      comps.push({ type: 'key_takeaways', content: ['Growth is volume-driven', 'Margin expanded two points', 'Pipeline coverage is healthy'] });
    }
    return { components: comps };
  }
  // DOCX / PDF — cover, body, table, appendix sections
  if (/cover/i.test(sectionTitle)) {
    comps.push({ type: 'paragraph', content: sentence('cover', 3) });
  } else if (/Executive Summary/i.test(sectionTitle)) {
    comps.push({ type: 'paragraph', content: sentence('executive summary', 4) });
    comps.push({ type: 'key_takeaways', content: ['Revenue grew 12% QoQ to $3,731', 'Unit volume up 8% across regions', 'Margin expanded to 34%'] });
    comps.push({
      type: 'metric_grid',
      content: [
        { label: 'Revenue', value: '$3,731', change: '+12% QoQ', unit: 'USD' },
        { label: 'Units Sold', value: '405', change: '+8% QoQ' },
        { label: 'Gross Margin', value: '34%', change: '+2 pts' },
      ],
    });
  } else if (/Performance Analysis/i.test(sectionTitle)) {
    comps.push({ type: 'heading', content: 'Quarterly Revenue Trend' });
    comps.push({ type: 'paragraph', content: sentence('analysis', 4) });
    comps.push({
      type: 'chart',
      content: { chartType: 'bar', title: 'Revenue by Month', categories: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Revenue', data: [1140, 1041, 1550] }], note: 'Monthly revenue in USD.' },
    });
    comps.push({ type: 'list', content: ['North region led with 120 units sold', 'South region maintained premium pricing', 'East region drove volume growth', 'No region declined quarter over quarter'] });
  } else if (/Detailed Results/i.test(sectionTitle)) {
    comps.push({ type: 'table', content: tableData('DOCX', false) });
    comps.push({ type: 'callout', content: 'Revenue concentration in the East region is the single largest execution risk for next quarter.' });
  } else if (/Roadmap/i.test(sectionTitle)) {
    comps.push({
      type: 'timeline',
      content: [
        { label: 'Q1', description: 'Launch regional pricing pilots' },
        { label: 'Q2', description: 'Scale the enterprise pipeline' },
        { label: 'Q3', description: 'Expand the East region team' },
      ],
    });
    comps.push({
      type: 'two_column',
      content: {
        leftTitle: 'Invest',
        leftPoints: ['East region capacity', 'Enterprise sales hiring', 'Pricing analytics'],
        rightTitle: 'Hold',
        rightPoints: ['South region discounts', 'New product lines', 'Office expansion'],
      },
    });
    comps.push({ type: 'quote', content: 'Volume growth, not price, is the engine of this quarter’s results.' });
  } else {
    comps.push({ type: 'paragraph', content: sentence('methodology', 4) });
    comps.push({ type: 'list', content: ['Data source: regional CRM export', 'Period: the most recent quarter', 'FX: constant currency'] });
  }
  return { components: comps };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      const system = (parsed.messages || []).find((m) => m.role === 'system')?.content || '';
      const user = (parsed.messages || []).find((m) => m.role === 'user')?.content || '';

      let content;
      if (system.includes("Filo's document designer")) {
        const fmt = /Target output format:\s*(\w+)/.exec(user)?.[1] || 'DOCX';
        content = JSON.stringify(designPlan(fmt));
      } else if (system.includes("Filo's document architect")) {
        // The architect prompt states the format authoritatively as
        // "OUTPUT FORMAT (…): PPTX" — match that line first, prose only as a
        // fallback.
        const fmt =
          /OUTPUT FORMAT[^\n:]*:\s*(\w+)/i.exec(system)?.[1] ||
          /output format is\s*(\w+)/i.exec(system)?.[1] ||
          'DOCX';
        content = JSON.stringify(blueprint(fmt));
      } else if (system.includes("Filo's content generator")) {
        const fmt = /Output Format:\s*(\w+)/.exec(system)?.[1] || 'DOCX';
        const title = /Section Title:\s*(.+)/.exec(user)?.[1]?.trim() || 'Section';
        content = JSON.stringify(contentFor(fmt, title));
      } else {
        content = JSON.stringify({ components: [{ type: 'paragraph', content: 'Unrecognized stage prompt — check the mock classifier.' }] });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `mock-${Date.now()}`,
          object: 'chat.completion',
          model: parsed.model || 'mock-1',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        })
      );
    } catch (err) {
      res.writeHead(500).end(JSON.stringify({ error: String(err) }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[mock-llm] listening on 127.0.0.1:${PORT}`));
