'use strict';

const lineList = document.getElementById('lineList');
const lineTemplate = document.getElementById('lineTemplate');
const addLineBtn = document.getElementById('addLineBtn');
const scriptInput = document.getElementById('scriptInput');
const parseScriptBtn = document.getElementById('parseScriptBtn');

const backgroundInput = document.getElementById('backgroundInput');
const backgroundPreview = document.getElementById('backgroundPreview');
const speakerAName = document.getElementById('speakerAName');
const speakerAGender = document.getElementById('speakerAGender');
const speakerAImage = document.getElementById('speakerAImage');
const speakerAPreview = document.getElementById('speakerAPreview');
const speakerBName = document.getElementById('speakerBName');
const speakerBGender = document.getElementById('speakerBGender');
const speakerBImage = document.getElementById('speakerBImage');
const speakerBPreview = document.getElementById('speakerBPreview');
const narrationGender = document.getElementById('narrationGender');

const generateBtn = document.getElementById('generateBtn');
const narrationToggle = document.getElementById('narrationToggle');
const narrationHint = document.getElementById('narrationHint');
const languageField = document.getElementById('languageField');
const captionsToggle = document.getElementById('captionsToggle');
const captionsHint = document.getElementById('captionsHint');
const kenBurnsToggle = document.getElementById('kenBurnsToggle');
const aspectSelect = document.getElementById('aspectSelect');
const languageSelect = document.getElementById('languageSelect');
const bgmInput = document.getElementById('bgmInput');
const bgmVolume = document.getElementById('bgmVolume');
const bgmVolumeLabel = document.getElementById('bgmVolumeLabel');
const progressArea = document.getElementById('progressArea');
const progressFill = document.getElementById('progressFill');
const progressMessage = document.getElementById('progressMessage');
const errorArea = document.getElementById('errorArea');
const resultArea = document.getElementById('resultArea');
const resultVideo = document.getElementById('resultVideo');
const downloadLink = document.getElementById('downloadLink');

let lines = [];
let lineSeq = 0;
let maxLines = 300;

function createLine(speaker = '', text = '') {
  return { id: ++lineSeq, speaker, text, imageFile: null, previewUrl: null };
}

function addLine(speaker = '', text = '', skipRender = false) {
  if (lines.length >= maxLines) return;
  lines.push(createLine(speaker, text));
  if (!skipRender) renderLines();
}

function removeLine(id) {
  lines = lines.filter((l) => l.id !== id);
  if (lines.length === 0) lines.push(createLine());
  renderLines();
}

function moveLine(id, direction) {
  const idx = lines.findIndex((l) => l.id === id);
  const target = idx + direction;
  if (target < 0 || target >= lines.length) return;
  [lines[idx], lines[target]] = [lines[target], lines[idx]];
  renderLines();
}

/**
 * Parses bulk-pasted script text into lines. A line matching
 * "<speakerName>: <text>" (using the names currently set for A/B) is
 * assigned to that speaker; anything else becomes a narration line.
 */
function parseScript(text) {
  const nameA = speakerAName.value.trim();
  const nameB = speakerBName.value.trim();
  const parsed = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.{1,40}?)[:：]\s*(.*)$/);
    if (match && nameA && match[1] === nameA) {
      parsed.push({ speaker: 'A', text: match[2] });
    } else if (match && nameB && match[1] === nameB) {
      parsed.push({ speaker: 'B', text: match[2] });
    } else {
      parsed.push({ speaker: '', text: trimmed });
    }
  }
  return parsed;
}

function renderLines() {
  lineList.innerHTML = '';
  lines.forEach((line, index) => {
    const node = lineTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.scene-number').textContent = `${index + 1}`;

    const speakerSelect = node.querySelector('.speaker-select');
    speakerSelect.value = line.speaker;
    speakerSelect.addEventListener('change', () => { line.speaker = speakerSelect.value; });

    const textarea = node.querySelector('.scene-text');
    textarea.value = line.text;
    textarea.addEventListener('input', () => { line.text = textarea.value; });

    const imageInput = node.querySelector('.line-image-input');
    const imagePreview = node.querySelector('.image-preview');
    const placeholder = node.querySelector('.image-placeholder');
    if (line.previewUrl) {
      imagePreview.src = line.previewUrl;
      imagePreview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    }
    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!file) return;
      line.imageFile = file;
      line.previewUrl = URL.createObjectURL(file);
      imagePreview.src = line.previewUrl;
      imagePreview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    });

    node.querySelector('.move-up').addEventListener('click', () => moveLine(line.id, -1));
    node.querySelector('.move-down').addEventListener('click', () => moveLine(line.id, 1));
    node.querySelector('.remove').addEventListener('click', () => removeLine(line.id));

    lineList.appendChild(node);
  });
}

function setupImagePreview(inputEl, previewEl, onSet) {
  inputEl.addEventListener('change', () => {
    const file = inputEl.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    previewEl.src = url;
    previewEl.classList.remove('hidden');
    previewEl.nextElementSibling && previewEl.nextElementSibling.classList.add('hidden');
    onSet(file);
  });
}

let backgroundFile = null;
let speakerAImageFile = null;
let speakerBImageFile = null;

setupImagePreview(backgroundInput, backgroundPreview, (f) => { backgroundFile = f; });
setupImagePreview(speakerAImage, speakerAPreview, (f) => { speakerAImageFile = f; });
setupImagePreview(speakerBImage, speakerBPreview, (f) => { speakerBImageFile = f; });

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    maxLines = config.maxLines || 300;
    if (Array.isArray(config.aspects) && config.aspects.length > 0) {
      aspectSelect.innerHTML = '';
      const labels = { '16:9': '16:9(横長 / YouTubeなど)', '9:16': '9:16(縦長 / ショート動画)', '1:1': '1:1(正方形)' };
      for (const aspect of config.aspects) {
        const opt = document.createElement('option');
        opt.value = aspect;
        opt.textContent = labels[aspect] || aspect;
        aspectSelect.appendChild(opt);
      }
    }
    if (!config.narrationAvailable) {
      narrationToggle.checked = false;
      narrationToggle.disabled = true;
      narrationHint.textContent = 'このサーバーには音声合成エンジン(espeak-ng)が見つかりません。字幕のみで動画が作成されます。';
      languageField.classList.add('hidden');
    }
    if (!config.captionsAvailable) {
      captionsToggle.checked = false;
      captionsToggle.disabled = true;
      captionsHint.textContent = 'このサーバーには日本語フォントが見つからないため、字幕は無効です。';
    }
  } catch {
    // ignore — defaults are already reasonable
  }
}

function showError(message) {
  errorArea.textContent = message;
  errorArea.classList.remove('hidden');
}

function clearError() {
  errorArea.classList.add('hidden');
  errorArea.textContent = '';
}

function validateLines() {
  if (lines.length === 0) return '台本を1行以上追加してください';
  if (lines.every((l) => !l.text.trim())) return '台本のテキストを入力してください';
  return null;
}

async function pollJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error('ジョブ状態の取得に失敗しました');
  const job = await res.json();

  progressFill.style.width = `${job.progress}%`;
  progressMessage.textContent = job.message || '';

  if (job.status === 'done') {
    progressArea.classList.add('hidden');
    resultArea.classList.remove('hidden');
    resultVideo.src = job.videoUrl;
    downloadLink.href = `${job.videoUrl}?download=1`;
    generateBtn.disabled = false;
    return;
  }
  if (job.status === 'error') {
    progressArea.classList.add('hidden');
    showError(job.message || '動画生成中にエラーが発生しました');
    generateBtn.disabled = false;
    return;
  }
  setTimeout(() => pollJob(jobId).catch((err) => {
    showError(err.message);
    generateBtn.disabled = false;
  }), 1200);
}

async function generateVideo() {
  clearError();
  resultArea.classList.add('hidden');

  const validationError = validateLines();
  if (validationError) {
    showError(validationError);
    return;
  }

  const settings = {
    narration: narrationToggle.checked && !narrationToggle.disabled,
    language: languageSelect.value,
    captions: captionsToggle.checked && !captionsToggle.disabled,
    kenBurns: kenBurnsToggle.checked,
    aspect: aspectSelect.value,
    bgmVolume: Number(bgmVolume.value) / 100,
    speakers: {
      A: { name: speakerAName.value.trim() || '話者A', gender: speakerAGender.value },
      B: { name: speakerBName.value.trim() || '話者B', gender: speakerBGender.value },
      narration: { gender: narrationGender.value },
    },
  };

  const formData = new FormData();
  formData.append('lines', JSON.stringify(lines.map((l) => ({ speaker: l.speaker || null, text: l.text }))));
  formData.append('settings', JSON.stringify(settings));
  if (backgroundFile) formData.append('background', backgroundFile);
  if (speakerAImageFile) formData.append('speakerA_image', speakerAImageFile);
  if (speakerBImageFile) formData.append('speakerB_image', speakerBImageFile);
  lines.forEach((line, i) => {
    if (line.imageFile) formData.append(`line_${i}_image`, line.imageFile);
  });
  if (bgmInput.files[0]) formData.append('bgm', bgmInput.files[0]);

  generateBtn.disabled = true;
  progressArea.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressMessage.textContent = 'アップロード中...';

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '動画生成の開始に失敗しました');
    await pollJob(data.jobId);
  } catch (err) {
    progressArea.classList.add('hidden');
    showError(err.message);
    generateBtn.disabled = false;
  }
}

addLineBtn.addEventListener('click', () => addLine());
parseScriptBtn.addEventListener('click', () => {
  const parsed = parseScript(scriptInput.value);
  if (parsed.length === 0) return;
  if (lines.length === 1 && !lines[0].text.trim() && !lines[0].speaker) {
    lines = [];
  }
  for (const p of parsed) addLine(p.speaker, p.text, true);
  renderLines();
  scriptInput.value = '';
});
generateBtn.addEventListener('click', generateVideo);
bgmVolume.addEventListener('input', () => { bgmVolumeLabel.textContent = `${bgmVolume.value}%`; });

lines.push(createLine());
renderLines();
loadConfig();
