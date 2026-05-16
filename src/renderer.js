let transcripts = [];
let results = [];
let selectedIndex = null;
let transcriptFolderPath = '';
let outputFolderPath = '';
let latestRunFolderPath = '';

const SAVED_KEY_MASK = '••••••••••••••••';
const MAX_PARALLEL_GRADING_REQUESTS = 3;
const el = id => document.getElementById(id);
const tbody = document.querySelector('#transcriptsTable tbody');

window.addEventListener('DOMContentLoaded', async () => {
  const settings = await window.graderAPI.getSettings();
  el('apiBaseUrl').value = settings.apiBaseUrl || '';
  el('model').value = settings.model || '';
  if (settings.apiKeyPresent) {
    el('apiKey').value = SAVED_KEY_MASK;
    el('settingsStatus').textContent = 'API key is saved locally.';
  } else {
    el('apiKey').value = '';
    el('settingsStatus').textContent = 'No API key saved.';
  }

  el('saveSettingsBtn').addEventListener('click', saveSettings);
  el('clearKeyBtn').addEventListener('click', clearKey);
  el('loadFolderBtn').addEventListener('click', loadFolder);
  el('outputFolderBtn').addEventListener('click', selectOutputFolder);
  el('gradeAllBtn').addEventListener('click', gradeAll);
  el('openOutputFolderBtn').addEventListener('click', openOutputFolder);
  updateFolderSummary();
  updateGradeButtonState();
  updateOpenOutputButtonState();
});

async function saveSettings() {
  const apiKeyValue = el('apiKey').value;
  const settings = {
    apiBaseUrl: el('apiBaseUrl').value,
    model: el('model').value,
    apiKey: apiKeyValue === SAVED_KEY_MASK ? '' : apiKeyValue
  };
  const saved = await window.graderAPI.saveSettings(settings);
  if (saved.apiKeyPresent) {
    el('apiKey').value = SAVED_KEY_MASK;
    el('settingsStatus').textContent = 'Settings saved. API key is stored locally on this computer.';
  } else {
    el('apiKey').value = '';
    el('settingsStatus').textContent = 'Settings saved. No API key stored.';
  }
}

async function clearKey() {
  await window.graderAPI.clearApiKey();
  el('apiKey').value = '';
  el('settingsStatus').textContent = 'API key cleared.';
}

async function loadFolder() {
  const folderPath = await window.graderAPI.pickFolder();
  if (!folderPath) return;
  transcriptFolderPath = folderPath;
  latestRunFolderPath = '';
  transcripts = await window.graderAPI.loadFolder(folderPath);
  results = new Array(transcripts.length).fill(null);
  selectedIndex = null;
  renderTable();
  updateFolderSummary();
  updateGradeButtonState();
  updateOpenOutputButtonState();
  el('resultView').className = 'empty';
  el('resultView').textContent = transcripts.length ? 'Ready to grade after output folder is selected.' : 'No supported transcript files found.';
}

async function selectOutputFolder() {
  const folderPath = await window.graderAPI.pickOutputFolder();
  if (!folderPath) return;
  outputFolderPath = folderPath;
  latestRunFolderPath = '';
  updateFolderSummary();
  updateGradeButtonState();
  updateOpenOutputButtonState();
}

function updateFolderSummary() {
  const transcriptText = transcriptFolderPath || 'No transcript folder selected.';
  const outputText = latestRunFolderPath || outputFolderPath || 'No output folder selected.';
  el('folderSummary').innerHTML = `
    <div class="folderRow"><span>Transcript folder</span><strong title="${escapeHtml(transcriptText)}">${escapeHtml(shortenPath(transcriptText))}</strong></div>
    <div class="folderRow"><span>${latestRunFolderPath ? 'Latest results folder' : 'Output folder'}</span><strong title="${escapeHtml(outputText)}">${escapeHtml(shortenPath(outputText))}</strong></div>
  `;
}

function updateGradeButtonState() {
  el('gradeAllBtn').disabled = !(transcripts.length > 0 && transcriptFolderPath && outputFolderPath);
}

function updateOpenOutputButtonState() {
  el('openOutputFolderBtn').disabled = !(latestRunFolderPath || outputFolderPath);
}

async function gradeAll() {
  if (!outputFolderPath) {
    el('resultView').className = 'empty errorBox';
    el('resultView').textContent = 'Please select an output folder before grading.';
    return;
  }
  el('gradeAllBtn').disabled = true;
  const firstFileByStudentName = new Map();
  for (const transcript of transcripts) {
    const key = normalizeStudentName(transcript.ufName || transcript.fileName);
    if (!firstFileByStudentName.has(key)) {
      firstFileByStudentName.set(key, transcript.fileName);
    }
  }

  const gradeQueue = [];
  for (let i = 0; i < transcripts.length; i++) {
    const transcript = transcripts[i];
    const key = normalizeStudentName(transcript.ufName || transcript.fileName);
    const firstFileName = firstFileByStudentName.get(key);
    if (firstFileName && transcript.fileName !== firstFileName) {
      transcript.status = `Skipped: duplicate student name. First processed file: ${firstFileName}`;
      results[i] = null;
    } else {
      transcript.status = 'Queued';
      results[i] = null;
      gradeQueue.push(i);
    }
  }
  renderTable();

  let nextQueuePosition = 0;
  const workerCount = Math.min(MAX_PARALLEL_GRADING_REQUESTS, gradeQueue.length);

  async function gradeNextTranscript() {
    while (nextQueuePosition < gradeQueue.length) {
      const transcriptIndex = gradeQueue[nextQueuePosition++];
      const transcript = transcripts[transcriptIndex];
      transcript.status = 'Grading...';
      renderTable();
      try {
        const result = await window.graderAPI.gradeOne({ transcript, strictness: el('strictness').value });
        results[transcriptIndex] = result;
        transcript.status = 'Done';
      } catch (error) {
        transcript.status = `API Error: ${error.message}. No fallback grading was used.`;
      }
      renderTable();
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => gradeNextTranscript()));

  const gradedResults = results.filter(Boolean);
  if (gradedResults.length) {
    try {
      const exported = await window.graderAPI.exportResults({
        outputFolder: outputFolderPath,
        transcriptFolder: transcriptFolderPath,
        strictness: el('strictness').value,
        transcripts,
        results: gradedResults
      });
      latestRunFolderPath = exported.runFolder;
      updateFolderSummary();
      updateOpenOutputButtonState();
      el('resultView').className = 'empty successBox';
      el('resultView').innerHTML = `Grading complete. Results were saved in:<br><strong>${escapeHtml(exported.runFolder)}</strong><br><br>Generated files: CSV, XLSX, DOCX report, and CSV execution log.`;
    } catch (error) {
      el('resultView').className = 'empty errorBox';
      el('resultView').textContent = `Grading completed, but saving results failed: ${error.message}`;
    }
  } else {
    el('resultView').className = 'empty errorBox';
    el('resultView').textContent = 'No results were saved because no transcript was successfully graded by the API.';
  }
  updateGradeButtonState();
  updateOpenOutputButtonState();
}

async function openOutputFolder() {
  const folderToOpen = latestRunFolderPath || outputFolderPath;
  if (!folderToOpen) return;
  try {
    await window.graderAPI.openFolder(folderToOpen);
  } catch (error) {
    el('resultView').className = 'empty errorBox';
    el('resultView').textContent = `Could not open output folder: ${error.message}`;
  }
}


function normalizeStudentName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function shortenPath(value) {
  const text = String(value || '');
  if (text.length <= 72) return text;
  const normalized = text.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 3) return text;
  const prefix = /^[A-Za-z]:/.test(parts[0]) ? parts[0] : '';
  const ending = parts.slice(-3).join(' / ');
  return prefix ? `${prefix} / … / ${ending}` : `… / ${ending}`;
}

function renderTable() {
  tbody.innerHTML = '';
  transcripts.forEach((t, i) => {
    const r = results[i];
    const tr = document.createElement('tr');
    tr.className = r ? 'clickable' : '';
    tr.innerHTML = `
      <td title="${escapeHtml(t.fileName)}">${escapeHtml(t.ufName || t.fileName)}</td>
      <td>${escapeHtml(t.ufid || '')}</td>
      <td class="statusCell">${statusBadge(t.status || 'Pending')}</td>
      <td class="totalCell">${r ? `${r.total}/16; ${r.total10}/80` : ''}</td>
      <td class="passCell">${r ? `<span class="badge ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'Pass' : 'Needs Review'}</span>` : ''}</td>
    `;
    if (r) tr.addEventListener('click', () => showResult(i));
    tbody.appendChild(tr);
  });
}

function statusBadge(status) {
  const cls = status.startsWith('Error') || status.startsWith('API Error') ? 'error' : status === 'Done' ? 'pass' : 'pending';
  return `<span class="badge ${cls} statusBadge" title="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function showResult(i) {
  selectedIndex = i;
  const result = results[i];
  el('selectedLabel').textContent = result.fileName;
  el('resultView').className = '';
  el('resultView').innerHTML = `
    <p><strong>${escapeHtml(result.ufName || result.fileName)}</strong></p>
    <p>Total 0-2: <strong>${result.total}/16 (${result.percent}%)</strong><br>Total 0-10: <strong>${result.total10}/80 (${result.percent10}%)</strong> | ${result.pass ? '<span class="badge pass">Pass</span>' : '<span class="badge fail">Needs Review</span>'}</p>
    <p>${escapeHtml(result.overall_comment)}</p>
    ${result.items.map(item => `
      <div class="rubricItem">
        <h4>${escapeHtml(item.label)}</h4>
        <p class="score">Score 0-2: ${item.score}/2</p>
        <p class="score">Score 0-10: ${item.score10}/10</p>
        <p><strong>Comment:</strong> ${escapeHtml(item.comment)}</p>
        <p><strong>Evidence:</strong> ${escapeHtml(item.evidence)}</p>
      </div>
    `).join('')}
  `;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
