const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel } = require('docx');
const Store = require('electron-store');
const { RUBRIC, STRICTNESS, MAX_SCORE_PER_ITEM, MAX_SCORE_10_PER_ITEM, MAX_TOTAL_SCORE, MAX_TOTAL_SCORE_10, PASSING_SCORE } = require('./rubric');

const store = new Store({ name: 'patient-transfer-grader-settings' });

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1050,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('settings:get', () => {
  return {
    apiBaseUrl: store.get('apiBaseUrl', 'https://api.ai.it.ufl.edu'),
    model: store.get('model', 'granite-3.3-8b-instruct'),
    apiKeyPresent: Boolean(store.get('apiKey'))
  };
});

ipcMain.handle('settings:save', (_event, settings) => {
  if (settings.apiBaseUrl) store.set('apiBaseUrl', settings.apiBaseUrl.trim().replace(/\/$/, ''));
  if (settings.model) store.set('model', settings.model.trim());
  if (settings.apiKey && settings.apiKey.trim()) store.set('apiKey', settings.apiKey.trim());
  return { ok: true, apiKeyPresent: Boolean(store.get('apiKey')) };
});

ipcMain.handle('settings:clearApiKey', () => {
  store.delete('apiKey');
  return { ok: true };
});

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:pickOutputFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('folder:open', async (_event, folderPath) => {
  if (!folderPath) throw new Error('No output folder is available to open yet.');
  if (!fs.existsSync(folderPath)) throw new Error(`Folder does not exist: ${folderPath}`);
  const errorMessage = await shell.openPath(folderPath);
  if (errorMessage) throw new Error(errorMessage);
  return { ok: true };
});

ipcMain.handle('transcripts:loadFolder', async (_event, folderPath) => {
  const files = fs.readdirSync(folderPath)
    .filter(f => /\.(docx|txt|vtt)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(f => path.join(folderPath, f));
  const transcripts = [];
  for (const filePath of files) {
    const text = await extractText(filePath);
    const meta = parseFilename(path.basename(filePath));
    transcripts.push({ filePath, fileName: path.basename(filePath), text, ...meta });
  }
  return transcripts;
});

ipcMain.handle('grading:gradeOne', async (_event, payload) => {
  return await gradeTranscript(payload);
});

ipcMain.handle('export:save', async (_event, payload) => {
  const { outputFolder, transcriptFolder, results, transcripts, strictness } = payload;
  if (!outputFolder) throw new Error('No output folder selected.');
  if (!Array.isArray(results) || !results.length) throw new Error('No grading results to export.');

  const runStartedAt = new Date();
  const timeStamp = formatRunTimestamp(runStartedAt);
  const runFolder = path.join(outputFolder, `Patient-Transfer-Grading-${timeStamp}`);
  fs.mkdirSync(runFolder, { recursive: true });

  const sortedResults = sortResultsByStudentName(results);
  const csvPath = path.join(runFolder, `patient-transfer-grading-canvas-format-${timeStamp}.csv`);
  const xlsxPath = path.join(runFolder, `patient-transfer-grading-canvas-format-${timeStamp}.xlsx`);
  const docxPath = path.join(runFolder, `patient-transfer-grading-report-${timeStamp}.docx`);
  const logPath = path.join(runFolder, `patient-transfer-grading-log-${timeStamp}.csv`);

  fs.writeFileSync(csvPath, toCanvasCsv(sortedResults), 'utf8');
  await toCanvasXlsx(sortedResults, xlsxPath);
  await toDocxReport(sortedResults, docxPath);
  fs.writeFileSync(logPath, toExecutionLogCsv({
    runStartedAt,
    runFinishedAt: new Date(),
    transcriptFolder,
    outputFolder,
    runFolder,
    strictness,
    results: sortedResults,
    transcripts: Array.isArray(transcripts) ? transcripts : []
  }), 'utf8');

  return { runFolder, csvPath, xlsxPath, docxPath, logPath };
});

function formatRunTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}-${hh}-${min}-${ss}`;
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanTranscript(result.value || '');
  }
  return cleanTranscript(fs.readFileSync(filePath, 'utf8'));
}

function cleanTranscript(text) {
  return text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function parseFilename(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const parts = base.split('_');
  return {
    ufName: parts[0] || '',
    canvasId: parts[1] || '',
    ufid: parts[2] || ''
  };
}

async function gradeTranscript({ transcript, strictness }) {
  // API-only grading: this function must never generate local heuristic scores.
  // If the API request or JSON parsing fails, throw an error and leave the transcript ungraded.
  const apiKey = store.get('apiKey');
  if (!apiKey) throw new Error('Please save an API key in Settings before grading. No local fallback is available.');
  const apiBaseUrl = store.get('apiBaseUrl', 'https://api.ai.it.ufl.edu').replace(/\/$/, '');
  const model = store.get('model', 'granite-3.3-8b-instruct');
  const endpoint = apiBaseUrl.endsWith('/v1') ? `${apiBaseUrl}/chat/completions` : `${apiBaseUrl}/v1/chat/completions`;

  const messages = [
    { role: 'system', content: buildSystemPrompt(strictness || 'balanced') },
    { role: 'user', content: `Grade this Zoom transcript of a nursing student transferring care of Juan Gomez to a dental student colleague.\n\nTRANSCRIPT:\n${transcript.text}` }
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, temperature: 0.1 })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API request failed: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = parseJsonFromModel(content);
  return normalizeResult(parsed, transcript);
}

function buildSystemPrompt(strictness) {
  return `You are a grading assistant for an interprofessional patient transfer activity. Grade only the nursing student's performance, not the dental student's questions. The student is transferring care of Juan Gomez using SBAR: Situation, Background, Assessment, Recommendation.\n\nStrictness guidance: ${STRICTNESS[strictness] || STRICTNESS.balanced}\n\nUse this rubric with two scores for each item:
- score: integer score of 2, 1, or 0 only.
- score_10: numeric score from 0 to 10, allowing one decimal place if needed.\n${JSON.stringify(RUBRIC, null, 2)}\n\nImportant grading rules:\n1. Evidence must come only from the transcript. Do not invent details.\n2. The 0 to 10 score is independent, but it must align with these bands: 0 to 3.3 maps to score 0; 3.4 to 6.6 maps to score 1; 6.7 to 10 maps to score 2.\n3. If score_10 is less than 10, the comment must begin with a precise positive observation grounded in the transcript. Then add the deduction portion beginning with the exact point loss in parentheses, such as "(-5) " when score_10 is 5/10, or "(-1.5) " when score_10 is 8.5/10. The deduction sentence must precisely explain what was missing, vague, incomplete, or unsupported in the student's actual response. Do not use generic phrases such as "did not fully demonstrate all elements" or "could have been more complete" unless you also name the specific missing content.\n4. If score_10 is 10, do not use a point-loss prefix; write a concise positive comment grounded in the transcript.\n5. Be generous when the information is clearly communicated, even if the wording is informal.\n6. Protect privacy: do not include UFID, Canvas ID, phone numbers, or email addresses in comments.\n7. Return valid JSON only, with this exact structure:\n{\n  "overall_comment": "brief summary",\n  "items": [\n    {"id": "shared_values_respect", "score": 2, "score_10": 9.0, "comment": "...", "evidence": "short quote or paraphrase"}\n  ]\n}`;
}

function parseJsonFromModel(content) {
  const cleaned = String(content || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('The API response did not contain valid grading JSON. No local fallback was used.');
  }

  const rawJson = cleaned.slice(start, end + 1);
  const candidates = [
    rawJson,
    rawJson.replace(/,\s*([}\]])/g, '$1')
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`The API response was not valid JSON after cleanup: ${lastError.message}. No local fallback was used.`);
}

function clampScore10(value, fallbackScore) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.round(Math.max(0, Math.min(MAX_SCORE_10_PER_ITEM, numeric)) * 10) / 10;
  if (fallbackScore === 2) return 10;
  if (fallbackScore === 1) return 6.6;
  return 0;
}

function score2FromScore10(score10, fallbackScore) {
  if (Number.isFinite(Number(score10))) {
    if (score10 <= 3.3) return 0;
    if (score10 <= 6.6) return 1;
    return 2;
  }
  return fallbackScore;
}

function normalizeResult(parsed, transcript) {
  const byId = new Map((parsed.items || []).map(i => [i.id, i]));
  const items = RUBRIC.map(r => {
    const raw = byId.get(r.id) || {};
    const rawScore = Number.isFinite(Number(raw.score)) ? Math.round(Number(raw.score)) : 0;
    const fallbackScore = Math.max(0, Math.min(MAX_SCORE_PER_ITEM, rawScore));
    const score10 = clampScore10(raw.score_10 ?? raw.score10 ?? raw.ten_point_score, fallbackScore);
    const score = score2FromScore10(score10, fallbackScore);
    return {
      id: r.id,
      label: r.label,
      score,
      score10,
      comment: formatPointLossComment(raw.comment, score10, r.id, r.label, raw.evidence),
      evidence: scrub(String(raw.evidence || ''))
    };
  });
  const total = items.reduce((sum, item) => sum + item.score, 0);
  const total10 = Math.round(items.reduce((sum, item) => sum + item.score10, 0) * 10) / 10;
  const percent = Math.round((total / MAX_TOTAL_SCORE) * 1000) / 10;
  const percent10 = Math.round((total10 / MAX_TOTAL_SCORE_10) * 1000) / 10;
  return {
    fileName: transcript.fileName,
    ufName: transcript.ufName,
    canvasId: transcript.canvasId,
    ufid: transcript.ufid,
    total,
    percent,
    total10,
    percent10,
    pass: total >= PASSING_SCORE,
    overall_comment: scrub(String(parsed.overall_comment || '')),
    items
  };
}



function formatPointLossComment(rawComment, score10, rubricId = '', rubricLabel = '', rawEvidence = '') {
  const score = Number(score10);
  let cleanComment = scrub(String(rawComment || '').trim())
    .replace(/^The student lost \d+(?:\.\d+)? points? because\s+/i, '')
    .trim();

  if (!Number.isFinite(score) || score >= MAX_SCORE_10_PER_ITEM) {
    return cleanComment || 'The student fully met this rubric item with clear transcript evidence.';
  }

  const lost = Math.round((MAX_SCORE_10_PER_ITEM - score) * 10) / 10;
  const lostText = Number.isInteger(lost) ? String(lost) : String(lost.toFixed(1)).replace(/\.0$/, '');

  const normalized = normalizeDeductionSentence(cleanComment, rubricId, rubricLabel, rawEvidence);
  let positive = normalized.positive;
  let deduction = normalized.deduction;

  if (!positive) positive = buildRubricSpecificPositive(rubricId, rawEvidence);
  if (!deduction) deduction = buildRubricSpecificDeduction(rubricId, rawEvidence);

  positive = ensureSentence(positive);
  deduction = ensureSentence(deduction);

  return `${positive} (-${lostText}) ${deduction}`;
}

function normalizeDeductionSentence(comment, rubricId = '', rubricLabel = '', rawEvidence = '') {
  let text = String(comment || '').trim();
  if (!text) return { positive: '', deduction: '' };

  text = text
    .replace(/^because\s+/i, '')
    .replace(/^the student lost \d+(?:\.\d+)? points? because\s+/i, '')
    .trim();

  const pointLossMatch = text.match(/^(.*?)(?:\s*)\(-\d+(?:\.\d+)?\)\s*(.+)$/s);
  if (pointLossMatch) {
    return {
      positive: pointLossMatch[1].trim(),
      deduction: removeGenericDeduction(pointLossMatch[2].trim(), rubricId, rawEvidence)
    };
  }

  const oldPrefixMatch = text.match(/^\(-\d+(?:\.\d+)?\)\s*(.+)$/s);
  if (oldPrefixMatch) {
    return {
      positive: buildRubricSpecificPositive(rubricId, rawEvidence),
      deduction: removeGenericDeduction(oldPrefixMatch[1].trim(), rubricId, rawEvidence)
    };
  }

  const contrastRegex = /\b(however|but|although|though)\b/i;
  const contrastMatch = text.match(contrastRegex);
  if (contrastMatch && typeof contrastMatch.index === 'number') {
    const positive = text.slice(0, contrastMatch.index).trim().replace(/[;,]$/, '');
    const deduction = text.slice(contrastMatch.index).replace(contrastRegex, '').trim().replace(/^[,;:\s]+/, '');
    return {
      positive,
      deduction: removeGenericDeduction(deduction, rubricId, rawEvidence)
    };
  }

  const hasNegativeComponent = /\b(did not|does not|missing|missed|limited|lacked|unclear|incomplete|not explicitly|could have|should have|needs to|would benefit|vague|unsupported|insufficient)\b/i.test(text);
  const looksPositiveOnly = /\b(respectfully|clearly|appropriately|professional|respectful|acknowledg|introduces|states|communicates|maintains|demonstrates|provides|includes|addresses|shows|explains|identifies|summarizes)\b/i.test(text) && !hasNegativeComponent;

  if (looksPositiveOnly) {
    return {
      positive: text,
      deduction: buildRubricSpecificDeduction(rubricId, rawEvidence)
    };
  }

  if (hasNegativeComponent) {
    return {
      positive: buildRubricSpecificPositive(rubricId, rawEvidence),
      deduction: removeGenericDeduction(text, rubricId, rawEvidence)
    };
  }

  return {
    positive: text,
    deduction: buildRubricSpecificDeduction(rubricId, rawEvidence)
  };
}

function removeGenericDeduction(text, rubricId = '', rawEvidence = '') {
  const value = String(text || '').trim();
  const generic = /did not fully demonstrate all elements|all elements of this rubric item|could have been more complete|not enough detail|needs more detail|lacked detail/i;
  if (!value || generic.test(value)) return buildRubricSpecificDeduction(rubricId, rawEvidence);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildRubricSpecificPositive(rubricId, rawEvidence = '') {
  const evidence = scrub(String(rawEvidence || '')).trim();
  const evidencePhrase = evidence ? ` The available evidence notes: ${evidence.replace(/[.!?]$/, '')}.` : '';
  const positives = {
    shared_values_respect: 'The student maintained a respectful and professional tone during the transfer.',
    roles_expertise: "The student showed awareness that the transfer involved both the nursing role and the dental student's role in the patient's care.",
    responsive_respectful_communication: 'The student communicated with the team member in a professional and responsive manner.',
    teamwork_principles: 'The student engaged in the transfer as a collaborative team interaction.',
    situation: "The student identified the patient's immediate situation during the handoff.",
    background: 'The student provided some relevant patient background for the transfer.',
    assessment: 'The student offered some assessment information about the patient.',
    recommendation: 'The student included a recommendation or next-step direction for care.'
  };
  return (positives[rubricId] || 'The student demonstrated some relevant performance for this rubric item.') + evidencePhrase;
}

function buildRubricSpecificDeduction(rubricId, rawEvidence = '') {
  const deductions = {
    shared_values_respect: 'The transcript does not show enough specific evidence of shared values, ethical framing, or mutual respect beyond basic professionalism.',
    roles_expertise: "The transcript does not clearly connect the student's nursing role and the dental student's expertise to specific patient outcomes.",
    responsive_respectful_communication: 'The communication is not consistently specific enough to show full responsiveness, responsibility, respect, and compassion toward the team member.',
    teamwork_principles: 'The transcript does not clearly show active teamwork behaviors such as shared planning, checking understanding, or coordinating next steps.',
    situation: "The situation statement is missing or vague about the patient's immediate reason for transfer and current concern.",
    background: 'The background information is incomplete because key clinically relevant history or context is not clearly stated.',
    assessment: "The assessment is incomplete because the student's clinical interpretation of the patient's status is vague or missing.",
    recommendation: 'The recommendation is incomplete because the next steps for further care are not specific or clearly actionable.'
  };
  return deductions[rubricId] || 'The transcript does not provide enough specific evidence to justify full credit for this rubric item.';
}

function ensureSentence(text) {
  let value = scrub(String(text || '').trim());
  if (!value) return '';
  value = value.charAt(0).toUpperCase() + value.slice(1);
  if (!/[.!?]$/.test(value)) value += '.';
  return value;
}

function scrub(text) {
  return text
    .replace(/\b\d{8}\b/g, '[UFID removed]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone removed]');
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function studentSortName(result) {
  return String(result.ufName || result.fileName || '').trim().toLocaleLowerCase();
}

function sortResultsByStudentName(results) {
  return [...results].sort((a, b) => {
    const nameCompare = studentSortName(a).localeCompare(studentSortName(b));
    if (nameCompare !== 0) return nameCompare;
    return String(a.fileName || '').localeCompare(String(b.fileName || ''));
  });
}

function toExecutionLogCsv({ runStartedAt, runFinishedAt, transcriptFolder, outputFolder, runFolder, strictness, results, transcripts }) {
  const skippedDuplicates = transcripts.filter(t => String(t.status || '').toLowerCase().includes('duplicate student name'));
  const apiErrorsOrUngraded = transcripts.filter(t => !results.some(r => r.fileName === t.fileName) && !skippedDuplicates.some(d => d.fileName === t.fileName));
  const rows = [];

  rows.push(['Section', 'Student Name', 'File Name', 'Canvas ID', 'UFID', 'Status', 'Score 0-2', 'Score 0-10', 'Needs Revision', 'Details']);
  rows.push(['Run Summary', '', '', '', '', 'Started', '', '', '', runStartedAt.toLocaleString()]);
  rows.push(['Run Summary', '', '', '', '', 'Finished', '', '', '', runFinishedAt.toLocaleString()]);
  rows.push(['Run Summary', '', '', '', '', 'Transcript Folder', '', '', '', transcriptFolder || 'Not provided']);
  rows.push(['Run Summary', '', '', '', '', 'Selected Output Folder', '', '', '', outputFolder || 'Not provided']);
  rows.push(['Run Summary', '', '', '', '', 'Run Output Folder', '', '', '', runFolder || 'Not created']);
  rows.push(['Run Summary', '', '', '', '', 'Grading Strictness', '', '', '', strictness || 'balanced']);
  rows.push(['Run Summary', '', '', '', '', 'Files Found', transcripts.length, '', '', '']);
  rows.push(['Run Summary', '', '', '', '', 'Successfully Graded', results.length, '', '', '']);
  rows.push(['Run Summary', '', '', '', '', 'Skipped Duplicates', skippedDuplicates.length, '', '', '']);
  rows.push(['Run Summary', '', '', '', '', 'API Errors or Ungraded', apiErrorsOrUngraded.length, '', '', '']);

  for (const result of results) {
    rows.push([
      'Graded',
      result.ufName || result.fileName || '',
      result.fileName || '',
      result.canvasId || '',
      result.ufid || '',
      result.pass ? 'Pass' : 'Needs Review',
      `${result.total}/${MAX_TOTAL_SCORE}`,
      `${result.total10}/${MAX_TOTAL_SCORE_10}`,
      result.total < MAX_TOTAL_SCORE ? 'Yes' : 'No',
      result.overall_comment || ''
    ]);
  }

  for (const transcript of skippedDuplicates) {
    rows.push([
      'Skipped Duplicate',
      transcript.ufName || '',
      transcript.fileName || '',
      transcript.canvasId || '',
      transcript.ufid || '',
      'Not processed due to repeated student name',
      '',
      '',
      '',
      transcript.status || 'Duplicate student name'
    ]);
  }

  for (const transcript of apiErrorsOrUngraded) {
    rows.push([
      'API Error or Ungraded',
      transcript.ufName || '',
      transcript.fileName || '',
      transcript.canvasId || '',
      transcript.ufid || '',
      transcript.status || 'Unknown',
      '',
      '',
      '',
      'No local heuristic fallback grading was used.'
    ]);
  }

  rows.push(['Note', '', '', '', '', 'API-only grading', '', '', '', 'This tool uses API-only grading. No local heuristic fallback grading was used.']);
  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

function toCanvasHeaders() {
  const headers = ['Student Name', 'Canvas ID', 'UFID', 'Posted Score 0-2', 'Posted Score 0-10', 'Needs Revision'];
  for (const r of RUBRIC) {
    headers.push(`Points 0-2: ${r.label}`, `Points 0-10: ${r.label}`, `Comments: ${r.label}`);
  }
  return headers;
}

function toCanvasRows(results) {
  return results.map(result => {
    const row = [
      result.ufName || result.fileName,
      result.canvasId || '',
      result.ufid || '',
      result.total,
      result.total10,
      result.total < MAX_TOTAL_SCORE ? 'Yes' : 'No'
    ];
    for (const rubric of RUBRIC) {
      const item = result.items.find(i => i.id === rubric.id) || {};
      row.push(item.score ?? 0, item.score10 ?? 0, item.comment || '');
    }
    return row;
  });
}

function toCanvasCsv(results) {
  const rows = [toCanvasHeaders(), ...toCanvasRows(results)];
  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

async function toCanvasXlsx(results, xlsxPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Patient Transfer Grading Support Tool';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Rubric Scores');

  const headers = toCanvasHeaders();
  worksheet.addRow(headers);
  for (const row of toCanvasRows(results)) worksheet.addRow(row);

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, results.length + 1), column: headers.length }
  };

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  worksheet.getRow(1).height = 42;

  worksheet.columns.forEach((column, index) => {
    const header = headers[index] || '';
    if (index === 0) column.width = 24;
    else if (index === 1) column.width = 16;
    else if (index === 2) column.width = 14;
    else if (index === 3) column.width = 14;
    else if (index === 4) column.width = 18;
    else if (index === 5) column.width = 16;
    else if (header.startsWith('Points 0-2:') || header.startsWith('Points 0-10:')) column.width = 16;
    else column.width = 42;
  });

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    if (rowNumber > 1) row.height = 60;
  });

  await workbook.xlsx.writeFile(xlsxPath);
}


async function toDocxReport(results, docxPath) {
  const children = [
    new Paragraph({
      text: 'Patient Transfer Grading Report',
      heading: HeadingLevel.TITLE
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generated: ${new Date().toLocaleString()}` })]
    }),
    new Paragraph({ text: '' })
  ];

  for (const result of results) {
    children.push(
      new Paragraph({ text: result.ufName || result.fileName, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: 'File: ', bold: true }), new TextRun(result.fileName || '')] }),
      new Paragraph({ children: [new TextRun({ text: 'Canvas ID: ', bold: true }), new TextRun(result.canvasId || '')] }),
      new Paragraph({ children: [new TextRun({ text: 'Total 0-2: ', bold: true }), new TextRun(`${result.total}/${MAX_TOTAL_SCORE} (${result.percent}%)`)] }),
      new Paragraph({ children: [new TextRun({ text: 'Total 0-10: ', bold: true }), new TextRun(`${result.total10}/${MAX_TOTAL_SCORE_10} (${result.percent10}%)`)] }),
      new Paragraph({ children: [new TextRun({ text: 'Status: ', bold: true }), new TextRun(result.pass ? 'Pass' : 'Needs Review')] }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'Overall Comment', bold: true })] }),
      new Paragraph({ text: result.overall_comment || '' }),
      new Paragraph({ text: '' })
    );

    const rows = [
      new TableRow({
        tableHeader: true,
        children: [
          makeCell('Rubric Item', true),
          makeCell('Score 0-2', true),
          makeCell('Score 0-10', true),
          makeCell('Comment', true),
          makeCell('Evidence', true)
        ]
      })
    ];

    for (const item of result.items) {
      rows.push(new TableRow({
        children: [
          makeCell(item.label || ''),
          makeCell(`${item.score}/${MAX_SCORE_PER_ITEM}`),
          makeCell(`${item.score10}/${MAX_SCORE_10_PER_ITEM}`),
          makeCell(item.comment || ''),
          makeCell(item.evidence || '')
        ]
      }));
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows
      }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: '' })
    );
  }

  const doc = new Document({
    creator: 'Patient Transfer Grading Support Tool',
    title: 'Patient Transfer Grading Report',
    sections: [{ children }]
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(docxPath, buffer);
}

function makeCell(text, bold = false) {
  return new TableCell({
    width: { size: bold ? 20 : 25, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text ?? ''), bold })]
      })
    ]
  });
}

// Backward-compatible alias in case older renderer builds call the old name.
function toCsv(results) {
  return toCanvasCsv(results);
}

function toHtml(results) {
  const rows = results.map(result => `
    <section class="student">
      <h2>${esc(result.ufName || result.fileName)}</h2>
      <p><strong>File:</strong> ${esc(result.fileName)}<br><strong>Canvas ID:</strong> ${esc(result.canvasId)}<br><strong>UFID:</strong> ${esc(result.ufid)}<br><strong>Total 0-2:</strong> ${result.total}/${MAX_TOTAL_SCORE} (${result.percent}%)<br><strong>Total 0-10:</strong> ${result.total10}/${MAX_TOTAL_SCORE_10} (${result.percent10}%) | <strong>${result.pass ? 'Pass' : 'Needs Review'}</strong></p>
      <p>${esc(result.overall_comment)}</p>
      <table><thead><tr><th>Rubric Item</th><th>Score 0-2</th><th>Score 0-10</th><th>Comment</th><th>Evidence</th></tr></thead><tbody>
      ${result.items.map(i => `<tr><td>${esc(i.label)}</td><td>${i.score}</td><td>${i.score10}</td><td>${esc(i.comment)}</td><td>${esc(i.evidence)}</td></tr>`).join('')}
      </tbody></table>
    </section>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Patient Transfer Grading Report</title><style>body{font-family:Arial,sans-serif;margin:32px;line-height:1.45}.student{page-break-after:always;margin-bottom:36px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #ccc;padding:8px;vertical-align:top}th{background:#f3f3f3}</style></head><body><h1>Patient Transfer Grading Report</h1>${rows}</body></html>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
