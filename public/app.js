'use strict';

const sceneList = document.getElementById('sceneList');
const sceneTemplate = document.getElementById('sceneTemplate');
const addSceneBtn = document.getElementById('addSceneBtn');
const generateBtn = document.getElementById('generateBtn');
const narrationToggle = document.getElementById('narrationToggle');
const narrationHint = document.getElementById('narrationHint');
const voiceFields = document.getElementById('voiceFields');
const captionsToggle = document.getElementById('captionsToggle');
const captionsHint = document.getElementById('captionsHint');
const kenBurnsToggle = document.getElementById('kenBurnsToggle');
const aspectSelect = document.getElementById('aspectSelect');
const genderSelect = document.getElementById('genderSelect');
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

let scenes = [];
let sceneSeq = 0;
let maxScenes = 40;

function createScene() {
  return { id: ++sceneSeq, text: '', imageFile: null, previewUrl: null };
}

function addScene() {
  if (scenes.length >= maxScenes) return;
  scenes.push(createScene());
  renderScenes();
}

function removeScene(id) {
  scenes = scenes.filter((s) => s.id !== id);
  if (scenes.length === 0) scenes.push(createScene());
  renderScenes();
}

function moveScene(id, direction) {
  const idx = scenes.findIndex((s) => s.id === id);
  const target = idx + direction;
  if (target < 0 || target >= scenes.length) return;
  [scenes[idx], scenes[target]] = [scenes[target], scenes[idx]];
  renderScenes();
}

function renderScenes() {
  sceneList.innerHTML = '';
  scenes.forEach((scene, index) => {
    const node = sceneTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.scene-number').textContent = `シーン ${index + 1}`;

    const textarea = node.querySelector('.scene-text');
    textarea.value = scene.text;
    textarea.addEventListener('input', () => { scene.text = textarea.value; });

    const imageInput = node.querySelector('.image-input');
    const imagePreview = node.querySelector('.image-preview');
    const placeholder = node.querySelector('.image-placeholder');
    if (scene.previewUrl) {
      imagePreview.src = scene.previewUrl;
      imagePreview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    }
    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!file) return;
      scene.imageFile = file;
      scene.previewUrl = URL.createObjectURL(file);
      imagePreview.src = scene.previewUrl;
      imagePreview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    });

    node.querySelector('.move-up').addEventListener('click', () => moveScene(scene.id, -1));
    node.querySelector('.move-down').addEventListener('click', () => moveScene(scene.id, 1));
    node.querySelector('.remove').addEventListener('click', () => removeScene(scene.id));

    sceneList.appendChild(node);
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    maxScenes = config.maxScenes || 40;
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
      voiceFields.classList.add('hidden');
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

function updateVoiceFieldsVisibility() {
  voiceFields.classList.toggle('hidden', !narrationToggle.checked || narrationToggle.disabled);
}

function showError(message) {
  errorArea.textContent = message;
  errorArea.classList.remove('hidden');
}

function clearError() {
  errorArea.classList.add('hidden');
  errorArea.textContent = '';
}

function validateScenes() {
  if (scenes.length === 0) return 'シーンを1つ以上追加してください';
  for (let i = 0; i < scenes.length; i++) {
    if (!scenes[i].imageFile) return `シーン ${i + 1} に画像をアップロードしてください`;
  }
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

  const validationError = validateScenes();
  if (validationError) {
    showError(validationError);
    return;
  }

  const settings = {
    narration: narrationToggle.checked && !narrationToggle.disabled,
    gender: genderSelect.value,
    language: languageSelect.value,
    captions: captionsToggle.checked,
    kenBurns: kenBurnsToggle.checked,
    aspect: aspectSelect.value,
    bgmVolume: Number(bgmVolume.value) / 100,
  };

  const formData = new FormData();
  formData.append('scenes', JSON.stringify(scenes.map((s) => ({ text: s.text }))));
  formData.append('settings', JSON.stringify(settings));
  scenes.forEach((scene, i) => formData.append(`image_${i}`, scene.imageFile));
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

addSceneBtn.addEventListener('click', addScene);
generateBtn.addEventListener('click', generateVideo);
narrationToggle.addEventListener('change', updateVoiceFieldsVisibility);
bgmVolume.addEventListener('input', () => { bgmVolumeLabel.textContent = `${bgmVolume.value}%`; });

scenes.push(createScene());
scenes.push(createScene());
renderScenes();
updateVoiceFieldsVisibility();
loadConfig();
