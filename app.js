
"use strict";

/* =========================================================
   MASTERMIND STUDY APP
   Offline-first study planner
   Storage: IndexedDB
   ========================================================= */

const $ = id => document.getElementById(id);

const DB_NAME = "MASTERMINDStudyDB";
const DB_VERSION = 1;
const STORE = "data";

const DEFAULTS = {
  name: "",
  notes: [],
  flashcards: [],
  pictures: [],
  exams: [],
  sessions: [],
  settings: {
    theme: "dark",
    pinHash: ""
  }
};

let state = structuredClone(DEFAULTS);
let db = null;

let timerInterval = null;
let remainingSeconds = 1500;
let timerRunning = false;
let currentSession = null;
let timerDeadline = null;

let editingNoteId = null;
let editingFlashId = null;
let savingExam = false;

/* ---------- General helpers ---------- */

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(36).slice(2);
}

function notify(message) {
  alert(message);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours} ঘণ্টা ${minutes} মিনিট`;
  }

  return `${totalMinutes} মিনিট`;
}

function cleanFilename(value) {
  return String(value || "mastermind")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 100) || "mastermind";
}

function validImageData(value) {
  return typeof value === "string" &&
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);
}

function escapeMultiline(value) {
  return safeText(value).replace(/\n/g, "<br>");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function normalizeState(incoming) {
  const defaults = structuredClone(DEFAULTS);
  incoming = incoming && typeof incoming === "object" ? incoming : {};

  return {
    ...defaults,
    ...incoming,
    notes: Array.isArray(incoming.notes) ? incoming.notes : [],
    flashcards: Array.isArray(incoming.flashcards)
      ? incoming.flashcards : [],
    pictures: Array.isArray(incoming.pictures)
      ? incoming.pictures.filter(pic =>
          pic &&
          typeof pic.id === "string" &&
          typeof pic.title === "string" &&
          validImageData(pic.data)
        )
      : [],
    exams: Array.isArray(incoming.exams) ? incoming.exams : [],
    sessions: Array.isArray(incoming.sessions)
      ? incoming.sessions : [],
    settings: {
      ...defaults.settings,
      ...(incoming.settings || {})
    }
  };
}

/* ---------- IndexedDB ---------- */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readDB(key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly")
      .objectStore(STORE)
      .get(key);

    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

function writeDB(key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");

    transaction.objectStore(STORE).put({ key, value });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function deleteDB(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");

    transaction.objectStore(STORE).delete(key);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function saveState() {
  await writeDB("appState", state);
}

async function saveSafely() {
  try {
    await saveState();
    return true;
  } catch (error) {
    console.error("Save failed:", error);
    notify("ডেটা সংরক্ষণ করা যায়নি। স্টোরেজে জায়গা আছে কি না দেখো।");
    return false;
  }
}

/* ---------- Theme and dashboard ---------- */

function applyTheme() {
  document.body.classList.toggle(
    "light-theme",
    state.settings.theme === "light"
  );

  $("themeBtn").textContent =
    state.settings.theme === "light" ? "☀️" : "🌙";

  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      state.settings.theme === "light" ? "#f3f6fc" : "#101827"
    );
}

function renderDashboard() {
  $("userGreeting").textContent = state.name || "শিক্ষার্থী";
  $("userName").value = state.name || "";

  $("notesCount").textContent = state.notes.length;
  $("cardsCount").textContent = state.flashcards.length;

  const todaySeconds = state.sessions
    .filter(session => session.date === dateKey())
    .reduce((sum, session) => sum + Number(session.seconds || 0), 0);

  $("todayTime").textContent = formatDuration(todaySeconds);
}

/* ---------- Notes ---------- */

function renderNotes() {
  const query = $("noteSearch").value.trim().toLowerCase();

  const notes = state.notes.filter(note =>
    `${note.title || ""} ${note.subject || ""} ${note.content || ""}`
      .toLowerCase()
      .includes(query)
  );

  $("notesList").innerHTML = notes.length
    ? notes.map(note => `
      <article class="item-card">
        <h3>${safeText(note.title)}</h3>
        <div class="item-meta">
          ${safeText(note.subject || "অন্যান্য")} ·
          ${safeText(note.updatedAt || note.date || "")}
        </div>
        <p>${escapeMultiline(note.content)}</p>
        <div class="item-actions">
          <button type="button" data-action="edit-note" data-id="${safeText(note.id)}">
            সম্পাদনা
          </button>
          <button type="button" data-action="share-note" data-id="${safeText(note.id)}">
            শেয়ার
          </button>
          <button type="button" class="delete-btn" data-action="delete-note" data-id="${safeText(note.id)}">
            মুছুন
          </button>
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">এখনো কোনো নোট নেই। নতুন নোট তৈরি করো।</div>';
}

$("saveNameBtn").addEventListener("click", async () => {
  const previousName = state.name;
  state.name = $("userName").value.trim();

  if (await saveSafely()) {
    renderDashboard();
    notify("তোমার নাম সংরক্ষণ করা হয়েছে।");
  } else {
    state.name = previousName;
    renderDashboard();
  }
});

$("themeBtn").addEventListener("click", async () => {
  const previous = state.settings.theme;

  state.settings.theme = previous === "dark" ? "light" : "dark";

  if (await saveSafely()) {
    applyTheme();
  } else {
    state.settings.theme = previous;
    applyTheme();
  }
});

$("saveNoteBtn").addEventListener("click", async () => {
  const title = $("noteTitle").value.trim();
  const content = $("noteContent").value.trim();
  const subject = $("noteSubject").value.trim();

  if (!title || !content) {
    return notify("নোটের নাম ও লেখা দুটোই পূরণ করো।");
  }

  const previousNotes = structuredClone(state.notes);

  if (editingNoteId) {
    const index = state.notes.findIndex(
      note => note.id === editingNoteId
    );

    if (index === -1) {
      editingNoteId = null;
      $("saveNoteBtn").textContent = "＋ নোট সংরক্ষণ";
      return notify("নোটটি খুঁজে পাওয়া যায়নি।");
    }

    state.notes[index] = {
      ...state.notes[index],
      title,
      subject,
      content,
      updatedAt: new Date().toLocaleString("bn-BD")
    };
  } else {
    state.notes.unshift({
      id: makeId(),
      title,
      subject,
      content,
      date: new Date().toLocaleString("bn-BD")
    });
  }

  if (!await saveSafely()) {
    state.notes = previousNotes;
    return;
  }

  editingNoteId = null;

  $("noteTitle").value = "";
  $("noteSubject").value = "";
  $("noteContent").value = "";
  $("saveNoteBtn").textContent = "＋ নোট সংরক্ষণ";

  renderAll();
  notify("নোট সংরক্ষণ করা হয়েছে।");
});

$("noteSearch").addEventListener("input", renderNotes);

/* ---------- Flashcards ---------- */

function renderFlashcards() {
  $("flashList").innerHTML = state.flashcards.length
    ? state.flashcards.map(card => `
      <article class="item-card">
        <h3>❓ ${safeText(card.question)}</h3>
        <details>
          <summary>উত্তর দেখো</summary>
          <p>${escapeMultiline(card.answer)}</p>
        </details>
        <div class="item-actions">
          <button type="button" data-action="edit-flash" data-id="${safeText(card.id)}">
            সম্পাদনা
          </button>
          <button type="button" class="delete-btn" data-action="delete-flash" data-id="${safeText(card.id)}">
            মুছুন
          </button>
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">এখনো কোনো ফ্ল্যাশকার্ড নেই।</div>';
}

$("saveFlashBtn").addEventListener("click", async () => {
  const question = $("flashQuestion").value.trim();
  const answer = $("flashAnswer").value.trim();

  if (!question || !answer) {
    return notify("প্রশ্ন ও উত্তর দুটোই লেখো।");
  }

  const previousCards = structuredClone(state.flashcards);

  if (editingFlashId) {
    const index = state.flashcards.findIndex(
      card => card.id === editingFlashId
    );

    if (index === -1) {
      editingFlashId = null;
      $("saveFlashBtn").textContent = "＋ ফ্ল্যাশকার্ড সংরক্ষণ";
      return notify("ফ্ল্যাশকার্ডটি খুঁজে পাওয়া যায়নি।");
    }

    state.flashcards[index] = {
      ...state.flashcards[index],
      question,
      answer
    };
  } else {
    state.flashcards.unshift({
      id: makeId(),
      question,
      answer
    });
  }

  if (!await saveSafely()) {
    state.flashcards = previousCards;
    return;
  }

  editingFlashId = null;

  $("flashQuestion").value = "";
  $("flashAnswer").value = "";
  $("saveFlashBtn").textContent = "＋ ফ্ল্যাশকার্ড সংরক্ষণ";

  renderAll();
  notify("ফ্ল্যাশকার্ড সংরক্ষণ করা হয়েছে।");
});

/* ---------- Pictures ---------- */

function renderPictures() {
  $("picturesList").innerHTML = state.pictures.length
    ? state.pictures.map(pic => `
      <article class="item-card">
        <h3>${safeText(pic.title)}</h3>
        <img
          class="saved-picture"
          src="${safeText(pic.data)}"
          alt="${safeText(pic.title)}"
          loading="lazy"
        >
        <div class="item-actions">
          <button type="button" data-action="rename-picture" data-id="${safeText(pic.id)}">
            নাম পরিবর্তন
          </button>
          <button type="button" data-action="share-picture" data-id="${safeText(pic.id)}">
            শেয়ার / ডাউনলোড
          </button>
          <button type="button" data-action="picture-pdf" data-id="${safeText(pic.id)}">
            PDF তৈরি
          </button>
          <button type="button" class="delete-btn" data-action="delete-picture" data-id="${safeText(pic.id)}">
            মুছুন
          </button>
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">এখনো কোনো ছবি সংরক্ষণ করা হয়নি।</div>';
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(file);
  });
}

$("savePictureBtn").addEventListener("click", async () => {
  const file = $("pictureFile").files[0];
  const title = $("pictureTitle").value.trim();

  if (!file) return notify("আগে একটি ছবি নির্বাচন করো।");

  if (!file.type.startsWith("image/")) {
    return notify("শুধু ছবির ফাইল নির্বাচন করা যাবে।");
  }

  if (file.size > 8 * 1024 * 1024) {
    return notify("ছবিটি ৮ MB-এর চেয়ে ছোট করে নির্বাচন করো।");
  }

  try {
    const data = await readFileAsDataURL(file);

    const pic = {
      id: makeId(),
      title: title || file.name,
      data
    };

    state.pictures.unshift(pic);

    if (!await saveSafely()) {
      state.pictures = state.pictures.filter(item => item.id !== pic.id);
      return;
    }

    $("pictureTitle").value = "";
    $("pictureFile").value = "";

    renderAll();
    notify("ছবি সংরক্ষণ করা হয়েছে।");
  } catch (error) {
    console.error(error);
    notify("ছবি পড়া যায়নি। আবার চেষ্টা করো।");
  }
});


/* ---------- Exams and countdown ---------- */

function renderExams() {
  const list = $("examsList");

  if (!list) return;

  const exams = [...state.exams].sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  if (!exams.length) {
    list.innerHTML =
      '<div class="empty-state">এখনো কোনো পরীক্ষার রুটিন যোগ করা হয়নি।</div>';
    return;
  }

  list.innerHTML = exams.map(exam => {
    const examTime = new Date(exam.date).getTime();
    const distance = examTime - Date.now();

    let countdown;

    if (Number.isNaN(examTime)) {
      countdown = "তারিখ সঠিক নয়";
    } else if (distance <= 0) {
      countdown = "পরীক্ষার সময় পেরিয়ে গেছে";
    } else {
      const total = Math.floor(distance / 1000);
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;

      countdown =
        `${days} দিন ${hours} ঘণ্টা ${minutes} মিনিট ${seconds} সেকেন্ড`;
    }

    const displayDate = Number.isNaN(examTime)
      ? exam.date
      : new Date(examTime).toLocaleString("bn-BD");

    return `
      <article class="item-card">
        <h3>${safeText(exam.title)}</h3>
        <p>⏳ ${safeText(countdown)}</p>
        <div class="item-meta">
          ${safeText(displayDate)}
        </div>
        <div class="item-actions">
          <button
            type="button"
            class="delete-btn"
            data-action="delete-exam"
            data-id="${safeText(exam.id)}"
          >মুছুন</button>
        </div>
      </article>
    `;
  }).join("");
}

$("saveExamBtn").addEventListener("click", async () => {
  if (savingExam) return;

  const titleInput = $("examTitle");
  const dateInput = $("examDate");

  const title = titleInput.value.trim();
  const dateValue = dateInput.value;

  if (!title || !dateValue) {
    notify("পরীক্ষার নাম ও তারিখ-সময় পূরণ করো।");
    return;
  }

  /*
   * datetime-local-এর মান স্থানীয় সময় হিসেবে যাচাই করা হচ্ছে।
   * Date.parse() দিয়ে সরাসরি UTC ধরে নেওয়া হচ্ছে না।
   */
  const match = dateValue.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
  );

  if (!match) {
    notify("সঠিক পরীক্ষার তারিখ ও সময় নির্বাচন করো।");
    return;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  const examDate = new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    0,
    0
  );

  const isValidDate =
    examDate.getFullYear() === year &&
    examDate.getMonth() === month - 1 &&
    examDate.getDate() === day &&
    examDate.getHours() === hour &&
    examDate.getMinutes() === minute;

  if (!isValidDate || Number.isNaN(examDate.getTime())) {
    notify("নির্বাচিত তারিখ ও সময় সঠিক নয়।");
    return;
  }

  if (examDate.getTime() <= Date.now()) {
    notify("বর্তমান সময়ের পরের কোনো তারিখ ও সময় নির্বাচন করো।");
    return;
  }

  savingExam = true;

  const exam = {
    id: makeId(),
    title,
    // ISO string-এ সংরক্ষণ করলে সময় নির্ভরযোগ্যভাবে ফিরে পাওয়া যায়।
    date: examDate.toISOString()
  };

  state.exams.push(exam);

  try {
    const saved = await saveSafely();

    if (!saved) {
      state.exams = state.exams.filter(item => item.id !== exam.id);
      renderExams();
      return;
    }

    titleInput.value = "";
    dateInput.value = "";

    renderExams();

    notify("পরীক্ষার রুটিন সফলভাবে সংরক্ষণ করা হয়েছে।");
  } catch (error) {
    console.error("Exam save failed:", error);

    state.exams = state.exams.filter(item => item.id !== exam.id);

    renderExams();

    notify("পরীক্ষার রুটিন সংরক্ষণ করা যায়নি। আবার চেষ্টা করো।");
  } finally {
    savingExam = false;
  }
});

/* ---------- Study history ---------- */

function renderHistory() {
  const grouped = {};

  for (const session of state.sessions) {
    const key = `${session.date}|||${session.subject}`;
    grouped[key] = (grouped[key] || 0) + Number(session.seconds || 0);
  }

  const entries = Object.entries(grouped).sort(
    (a, b) => b[0].localeCompare(a[0])
  );

  $("studyHistory").innerHTML = entries.length
    ? entries.map(([key, seconds]) => {
      const [date, subject] = key.split("|||");

      return `
        <article class="item-card">
          <h3>${safeText(subject)}</h3>
          <p>${safeText(date)} · ${safeText(formatDuration(seconds))}</p>
        </article>
      `;
    }).join("")
    : '<div class="empty-state">পড়ার সেশন সম্পন্ন হলে এখানে দেখা যাবে।</div>';
}

/* ---------- Focus timer ---------- */

function updateTimerDisplay() {
  const minutes = Math.floor(Math.max(0, remainingSeconds) / 60);
  const seconds = Math.max(0, remainingSeconds) % 60;

  $("timerDisplay").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function selectedMinutes() {
  const minutes = Number($("focusMinutes").value) || 25;
  return Math.max(1, Math.min(300, Math.floor(minutes)));
}

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  timerRunning = false;
}

function stopTimerIntervalOnly() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function refreshTimer() {
  if (!timerRunning || timerDeadline === null) return;

  remainingSeconds = Math.max(
    0,
    Math.ceil((timerDeadline - Date.now()) / 1000)
  );

  updateTimerDisplay();

  if (remainingSeconds <= 0) {
    finishSession();
  }
}

async function finishSession() {
  if (!currentSession) {
    stopTimer();
    return;
  }

  stopTimer();
  remainingSeconds = 0;
  updateTimerDisplay();

  const completedSeconds = currentSession.plannedSeconds;

  const session = {
    id: makeId(),
    subject: currentSession.subject,
    seconds: completedSeconds,
    date: dateKey()
  };

  state.sessions.push(session);

  if (!await saveSafely()) {
    state.sessions = state.sessions.filter(item => item.id !== session.id);
  }

  currentSession = null;
  timerDeadline = null;

  renderAll();
  $("timerMessage").textContent = "সেশন শেষ! ভালো কাজ করেছো।";

  notify("ফোকাস সেশন শেষ হয়েছে।");
}

$("focusMinutes").addEventListener("change", () => {
  if (timerRunning) return;

  remainingSeconds = selectedMinutes() * 60;
  $("focusMinutes").value = selectedMinutes();

  updateTimerDisplay();
});

$("startTimerBtn").addEventListener("click", () => {
  if (timerRunning) return;

  if (!currentSession || remainingSeconds <= 0) {
    remainingSeconds = selectedMinutes() * 60;

    currentSession = {
      subject: $("studySubject").value.trim() || "অন্যান্য",
      plannedSeconds: remainingSeconds
    };
  }

  timerRunning = true;
  timerDeadline = Date.now() + remainingSeconds * 1000;

  $("timerMessage").textContent = "মনোযোগ দিয়ে পড়তে থাকো!";

  stopTimerIntervalOnly();
  timerInterval = setInterval(refreshTimer, 250);

  updateTimerDisplay();
});

$("pauseTimerBtn").addEventListener("click", () => {
  if (!timerRunning) return;

  remainingSeconds = Math.max(
    0,
    Math.ceil((timerDeadline - Date.now()) / 1000)
  );

  stopTimer();
  timerDeadline = null;

  updateTimerDisplay();
  $("timerMessage").textContent = "টাইমার বিরতিতে আছে।";
});

$("resetTimerBtn").addEventListener("click", () => {
  stopTimer();
  currentSession = null;
  timerDeadline = null;

  remainingSeconds = selectedMinutes() * 60;

  updateTimerDisplay();
  $("timerMessage").textContent = "টাইমার রিসেট হয়েছে।";
});

/* ---------- Share and download ---------- */

async function shareText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(`${title}\n\n${text}`);
    notify("লেখা কপি করা হয়েছে।");
  } catch {
    notify("এই ব্রাউজারে শেয়ার বা কপি করা যায়নি।");
  }
}

async function sharePicture(pic) {
  if (!validImageData(pic.data)) {
    return notify("ছবির ডেটা সঠিক নয়।");
  }

  try {
    const response = await fetch(pic.data);
    const blob = await response.blob();

    const extension = blob.type === "image/png" ? "png" : "jpg";
    const filename = `${cleanFilename(pic.title)}.${extension}`;

    const file = new File([blob], filename, {
      type: blob.type || "image/jpeg"
    });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: pic.title
        });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    downloadBlob(blob, filename);
  } catch (error) {
    console.error(error);
    notify("ছবিটি শেয়ার বা ডাউনলোড করা যায়নি।");
  }
}

/* ---------- PDF generation: no external library ---------- */

function stringBytes(value) {
  return new TextEncoder().encode(value);
}

async function imageDataToJpeg(dataURL) {
  const response = await fetch(dataURL);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const maxDimension = 2000;
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height)
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Canvas unavailable");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  bitmap.close();

  const jpegBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      result => result
        ? resolve(result)
        : reject(new Error("JPEG failed")),
      "image/jpeg",
      0.90
    );
  });

  return {
    bytes: new Uint8Array(await jpegBlob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height
  };
}

function buildImagePdf(image) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;

  const scale = Math.min(
    pageWidth / image.width,
    pageHeight / image.height
  );

  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;

  const content = [
    "q",
    `${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm`,
    "/Im0 Do",
    "Q"
  ].join("\n");

  const chunks = [];
  let byteLength = 0;
  const offsets = [0];

  function addBytes(bytes) {
    chunks.push(bytes);
    byteLength += bytes.length;
  }

  function addString(text) {
    addBytes(stringBytes(text));
  }

  function addObject(number, parts) {
    offsets[number] = byteLength;

    addString(`${number} 0 obj\n`);

    for (const part of parts) {
      if (typeof part === "string") {
        addString(part);
      } else {
        addBytes(part);
      }
    }

    addString("\nendobj\n");
  }

  addString("%PDF-1.4\n");

  addObject(1, [
    "<< /Type /Catalog /Pages 2 0 R >>"
  ]);

  addObject(2, [
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"
  ]);

  addObject(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `,
    "/Resources << /XObject << /Im0 4 0 R >> >> ",
    "/Contents 5 0 R >>"
  ]);

  addObject(4, [
    `<< /Type /XObject /Subtype /Image /Width ${image.width} `,
    `/Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 `,
    `/Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
    image.bytes,
    "\nendstream"
  ]);

  const contentBytes = stringBytes(content);

  addObject(5, [
    `<< /Length ${contentBytes.length} >>\nstream\n`,
    contentBytes,
    "\nendstream"
  ]);

  const xrefOffset = byteLength;

  addString(`xref\n0 ${offsets.length}\n`);
  addString("0000000000 65535 f \n");

  for (let i = 1; i < offsets.length; i++) {
    addString(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }

  addString(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  );

  return new Blob(chunks, { type: "application/pdf" });
}

async function createPdfFromData(data, title) {
  if (!validImageData(data)) {
    throw new Error("Invalid image data");
  }

  const image = await imageDataToJpeg(data);
  const pdf = buildImagePdf(image);

  downloadBlob(pdf, `${cleanFilename(title)}.pdf`);
}

$("pdfBtn").addEventListener("click", async () => {
  const file = $("pictureFile").files[0];

  try {
    if (file) {
      if (!file.type.startsWith("image/")) {
        return notify("একটি ছবির ফাইল নির্বাচন করো।");
      }

      if (file.size > 12 * 1024 * 1024) {
        return notify("PDF-এর জন্য ১২ MB-এর ছোট ছবি ব্যবহার করো।");
      }

      const data = await readFileAsDataURL(file);

      await createPdfFromData(
        data,
        $("pictureTitle").value.trim() || file.name
      );

      notify("PDF তৈরি হয়েছে।");
      return;
    }

    if (!state.pictures.length) {
      return notify("আগে একটি ছবি নির্বাচন করো অথবা ছবি সংরক্ষণ করো।");
    }

    const options = state.pictures
      .map((pic, index) => `${index + 1}. ${pic.title}`)
      .join("\n");

    const answer = prompt(
      "কোন সংরক্ষিত ছবির PDF বানাবে? নম্বর লেখো:\n\n" + options,
      "1"
    );

    if (answer === null) return;

    const index = Number(answer) - 1;
    const pic = state.pictures[index];

    if (!pic) {
      return notify("সঠিক ছবির নম্বর দাও।");
    }

    await createPdfFromData(pic.data, pic.title);
    notify("PDF তৈরি হয়েছে।");
  } catch (error) {
    console.error("PDF generation failed:", error);
    notify("PDF তৈরি করা যায়নি। অন্য একটি ছবি দিয়ে চেষ্টা করো।");
  }
});

/* ---------- PIN lock ---------- */

async function hashPin(pin) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pin)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function askPin(title, text, placeholder = "PIN") {
  return new Promise(resolve => {
    const dialog = $("appDialog");
    const form = dialog.querySelector("form");
    const input = $("dialogInput");
    const cancelButton = $("dialogCancel");

    $("dialogTitle").textContent = title;
    $("dialogText").textContent = text;

    input.value = "";
    input.placeholder = placeholder;

    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;

      cleanup();

      if (dialog.open) dialog.close();

      resolve(value);
    }

    function cleanup() {
      form.removeEventListener("submit", onSubmit);
      cancelButton.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
    }

    function onSubmit(event) {
      event.preventDefault();
      finish(input.value);
    }

    function onCancel(event) {
      event.preventDefault();
      finish(null);
    }

    function onClose() {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }

    form.addEventListener("submit", onSubmit);
    cancelButton.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);

    dialog.showModal();
    input.focus();
  });
}

$("lockBtn").addEventListener("click", async () => {
  try {
    const existingHash = state.settings.pinHash;

    if (existingHash) {
      const currentPin = await askPin(
        "অ্যাপ লক সেটিংস",
        "পরিবর্তন করতে বর্তমান PIN দাও।"
      );

      if (currentPin === null) return;

      if (await hashPin(currentPin) !== existingHash) {
        return notify("PIN সঠিক নয়।");
      }

      const newPin = await askPin(
        "নতুন PIN",
        "নতুন ৪–১২ অক্ষরের PIN দাও। লক বন্ধ করতে ফাঁকা রাখো।"
      );

      if (newPin === null) return;

      if (newPin === "") {
        state.settings.pinHash = "";
      } else {
        if (newPin.length < 4 || newPin.length > 12) {
          return notify("PIN অবশ্যই ৪–১২ অক্ষরের হতে হবে।");
        }

        state.settings.pinHash = await hashPin(newPin);
      }
    } else {
      const pin = await askPin(
        "অ্যাপ লক চালু",
        "একটি ৪–১২ অক্ষরের PIN তৈরি করো।"
      );

      if (pin === null) return;

      if (pin.length < 4 || pin.length > 12) {
        return notify("PIN অবশ্যই ৪–১২ অক্ষরের হতে হবে।");
      }

      state.settings.pinHash = await hashPin(pin);
    }

    if (await saveSafely()) {
      notify(
        state.settings.pinHash
          ? "অ্যাপ লক চালু হয়েছে।"
          : "অ্যাপ লক বন্ধ হয়েছে।"
      );
    }
  } catch (error) {
    console.error(error);
    notify("লক সেটিংস পরিবর্তন করা যায়নি।");
  }
});

async function requireUnlock() {
  if (!state.settings.pinHash) return true;

  while (true) {
    const pin = await askPin(
      "MASTERMIND — আনলক",
      "অ্যাপ ব্যবহার করতে তোমার PIN দাও।"
    );

    if (pin !== null && await hashPin(pin) === state.settings.pinHash) {
      return true;
    }

    notify("PIN সঠিক নয়। অ্যাপ আনলক করতে সঠিক PIN দাও।");
  }
}

/* ---------- Data export and import ---------- */

$("exportBtn").addEventListener("click", () => {
  const payload = {
    app: "MASTERMIND-study-app",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: "application/json" }
  );

  downloadBlob(blob, "mastermind-study-backup.json");
});

$("importBtn").addEventListener("click", () => {
  $("importFile").click();
});

$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  if (!file) return;

  try {
    if (file.size > 50 * 1024 * 1024) {
      throw new Error("Backup too large");
    }

    const payload = JSON.parse(await file.text());
    const incoming = payload.data;

    if (
      payload.app !== "MASTERMIND-study-app" ||
      !incoming ||
      !Array.isArray(incoming.notes) ||
      !Array.isArray(incoming.flashcards) ||
      !Array.isArray(incoming.pictures) ||
      !Array.isArray(incoming.exams) ||
      !Array.isArray(incoming.sessions)
    ) {
      throw new Error("Invalid backup");
    }

    if (!confirm("ব্যাকআপের ডেটা দিয়ে বর্তমান ডেটা প্রতিস্থাপন হবে। চালিয়ে যাবে?")) {
      return;
    }

    const previousState = state;
    state = normalizeState(incoming);

    try {
      await saveState();
    } catch (error) {
      state = previousState;
      throw error;
    }

    editingNoteId = null;
    editingFlashId = null;

    $("noteTitle").value = "";
    $("noteSubject").value = "";
    $("noteContent").value = "";
    $("flashQuestion").value = "";
    $("flashAnswer").value = "";

    $("saveNoteBtn").textContent = "＋ নোট সংরক্ষণ";
    $("saveFlashBtn").textContent = "＋ ফ্ল্যাশকার্ড সংরক্ষণ";

    renderAll();
    notify("ব্যাকআপ Import সম্পন্ন হয়েছে।");
  } catch (error) {
    console.error(error);
    notify("ব্যাকআপ ফাইলটি সঠিক নয়, খুব বড়, অথবা পড়া যায়নি।");
  } finally {
    $("importFile").value = "";
  }
});

/* ---------- Delete all data ---------- */

$("deleteAllBtn").addEventListener("click", async () => {
  if (!confirm(
    "সব নোট, ছবি, ফ্ল্যাশকার্ড, পরীক্ষার রুটিন ও পড়ার হিসাব মুছে যাবে। আগে ব্যাকআপ নিয়েছো?"
  )) {
    return;
  }

  if (!confirm("শেষবার নিশ্চিত হও: সব অ্যাপ ডেটা মুছে ফেলবে?")) {
    return;
  }

  stopTimer();
  currentSession = null;
  timerDeadline = null;

  const previousState = state;
  state = structuredClone(DEFAULTS);

  try {
    await deleteDB("appState");
  } catch (error) {
    state = previousState;
    console.error(error);
    return notify("ডেটা মুছে ফেলা যায়নি।");
  }

  editingNoteId = null;
  editingFlashId = null;

  $("noteTitle").value = "";
  $("noteSubject").value = "";
  $("noteContent").value = "";
  $("flashQuestion").value = "";
  $("flashAnswer").value = "";

  $("saveNoteBtn").textContent = "＋ নোট সংরক্ষণ";
  $("saveFlashBtn").textContent = "＋ ফ্ল্যাশকার্ড সংরক্ষণ";

  remainingSeconds = 1500;
  $("focusMinutes").value = 25;
  $("studySubject").value = "";
  $("timerMessage").textContent = "মনোযোগ দিয়ে শুরু করো!";

  updateTimerDisplay();
  renderAll();

  notify("অ্যাপের সব ডেটা মুছে ফেলা হয়েছে।");
});

/* ---------- Developer button ---------- */

$("developerBtn").addEventListener("click", () => {
  const message = $("developerMessage");
  message.hidden = !message.hidden;
});

/* ---------- Action buttons: Edit/Delete/Share ---------- */

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;

  if (!id) return;

  try {
    /* Edit note */
    if (action === "edit-note") {
      const note = state.notes.find(item => item.id === id);
      if (!note) return notify("নোটটি খুঁজে পাওয়া যায়নি।");

      editingNoteId = id;
      $("noteTitle").value = note.title || "";
      $("noteSubject").value = note.subject || "";
      $("noteContent").value = note.content || "";
      $("saveNoteBtn").textContent = "✓ নোট আপডেট";

      $("noteTitle").focus();

      window.scrollTo({
        top: $("noteTitle").getBoundingClientRect().top + window.scrollY - 100,
        behavior: "smooth"
      });

      return;
    }

    /* Delete note */
    if (action === "delete-note") {
      if (!confirm("এই নোটটি মুছে ফেলবে?")) return;

      const previous = structuredClone(state.notes);
      state.notes = state.notes.filter(item => item.id !== id);

      if (!await saveSafely()) {
        state.notes = previous;
        return;
      }

      if (editingNoteId === id) {
        editingNoteId = null;
        $("noteTitle").value = "";
        $("noteSubject").value = "";
        $("noteContent").value = "";
        $("saveNoteBtn").textContent = "＋ নোট সংরক্ষণ";
      }

      renderAll();
      notify("নোট মুছে ফেলা হয়েছে।");
      return;
    }

    /* Share note */
    if (action === "share-note") {
      const note = state.notes.find(item => item.id === id);

      if (note) {
        await shareText(
          note.title,
          `${note.subject || ""}\n\n${note.content || ""}`
        );
      }

      return;
    }

    /* Edit flashcard */
    if (action === "edit-flash") {
      const card = state.flashcards.find(item => item.id === id);
      if (!card) return notify("ফ্ল্যাশকার্ডটি খুঁজে পাওয়া যায়নি।");

      editingFlashId = id;
      $("flashQuestion").value = card.question || "";
      $("flashAnswer").value = card.answer || "";
      $("saveFlashBtn").textContent = "✓ ফ্ল্যাশকার্ড আপডেট";

      $("flashQuestion").focus();

      window.scrollTo({
        top: $("flashQuestion").getBoundingClientRect().top + window.scrollY - 100,
        behavior: "smooth"
      });

      return;
    }

    /* Delete flashcard */
    if (action === "delete-flash") {
      if (!confirm("এই ফ্ল্যাশকার্ডটি মুছে ফেলবে?")) return;

      const previous = structuredClone(state.flashcards);
      state.flashcards = state.flashcards.filter(item => item.id !== id);

      if (!await saveSafely()) {
        state.flashcards = previous;
        return;
      }

      if (editingFlashId === id) {
        editingFlashId = null;
        $("flashQuestion").value = "";
        $("flashAnswer").value = "";
        $("saveFlashBtn").textContent = "＋ ফ্ল্যাশকার্ড সংরক্ষণ";
      }

      renderAll();
      notify("ফ্ল্যাশকার্ড মুছে ফেলা হয়েছে।");
      return;
    }

    /* Rename picture */
    if (action === "rename-picture") {
      const pic = state.pictures.find(item => item.id === id);
      if (!pic) return notify("ছবিটি খুঁজে পাওয়া যায়নি।");

      const title = prompt("ছবির নতুন নাম লেখো:", pic.title);
      if (title === null || !title.trim()) return;

      const previous = structuredClone(state.pictures);
      pic.title = title.trim();

      if (!await saveSafely()) {
        state.pictures = previous;
        return;
      }

      renderPictures();
      notify("ছবির নাম পরিবর্তন হয়েছে।");
      return;
    }

    /* Share or download picture */
    if (action === "share-picture") {
      const pic = state.pictures.find(item => item.id === id);
      if (pic) await sharePicture(pic);
      return;
    }

    /* Create PDF from saved picture */
    if (action === "picture-pdf") {
      const pic = state.pictures.find(item => item.id === id);
      if (!pic) return notify("ছবিটি খুঁজে পাওয়া যায়নি।");

      await createPdfFromData(pic.data, pic.title);
      notify("PDF তৈরি হয়েছে।");
      return;
    }

    /* Delete picture */
    if (action === "delete-picture") {
      if (!confirm("এই ছবিটি মুছে ফেলবে?")) return;

      const previous = structuredClone(state.pictures);
      state.pictures = state.pictures.filter(item => item.id !== id);

      if (!await saveSafely()) {
        state.pictures = previous;
        return;
      }

      renderPictures();
      notify("ছবি মুছে ফেলা হয়েছে।");
      return;
    }

    /* Delete exam */
    if (action === "delete-exam") {
      if (!confirm("এই পরীক্ষার রুটিনটি মুছে ফেলবে?")) return;

      const previous = structuredClone(state.exams);
      state.exams = state.exams.filter(item => item.id !== id);

      if (!await saveSafely()) {
        state.exams = previous;
        return;
      }

      renderExams();
      notify("পরীক্ষার রুটিন মুছে ফেলা হয়েছে।");
      return;
    }
  } catch (error) {
    console.error("Action failed:", action, error);
    notify("কাজটি সম্পন্ন করা যায়নি। আবার চেষ্টা করো।");
  }
});

/* ---------- Render all ---------- */

function renderAll() {
  applyTheme();
  renderDashboard();
  renderNotes();
  renderFlashcards();
  renderPictures();
  renderExams();
  renderHistory();
}

/* ---------- Offline support ---------- */

function registerOfflineSupport() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("./service-worker.js")
    .catch(error => {
      console.error("Service Worker registration failed:", error);
    });
}

/* ---------- Start app ---------- */

async function initialize() {
  try {
    if (!window.indexedDB) {
      throw new Error("IndexedDB unavailable");
    }

    db = await openDatabase();

    const saved = await readDB("appState");

    if (saved && typeof saved === "object") {
      state = normalizeState(saved);
    }

    remainingSeconds = selectedMinutes() * 60;

    renderAll();
    updateTimerDisplay();

    registerOfflineSupport();

    await requireUnlock();
  } catch (error) {
    console.error("Initialization failed:", error);

    notify(
      "অ্যাপ চালু করা যায়নি। GitHub Pages-এর HTTPS লিংক এবং আধুনিক ব্রাউজার ব্যবহার করো।"
    );
  }
}

/* Refresh countdown without rebuilding other sections */
setInterval(() => {
  if (state.exams.length) renderExams();
}, 1000);

initialize();
