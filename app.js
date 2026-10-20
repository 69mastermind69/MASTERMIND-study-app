
"use strict";

const $ = (id) => document.getElementById(id);

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
  settings: { theme: "dark", pinHash: "" }
};

let state = structuredClone(DEFAULTS);
let db;
let timerInterval = null;
let remainingSeconds = 1500;
let timerRunning = false;
let sessionStartedAt = null;
let currentSession = null;
let lockUntil = 0;

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(36).slice(2);
}

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
      .objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

function writeDB(key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ key, value });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteDB(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function saveState() {
  await writeDB("appState", state);
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
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours) return `${hours} ঘণ্টা ${rest} মিনিট`;
  return `${minutes} মিনিট`;
}

function applyTheme() {
  document.body.classList.toggle(
    "light-theme",
    state.settings.theme === "light"
  );
  $("themeBtn").textContent =
    state.settings.theme === "light" ? "☀️" : "🌙";
}

function renderDashboard() {
  $("userGreeting").textContent = state.name || "শিক্ষার্থী";
  $("userName").value = state.name || "";
  $("notesCount").textContent = state.notes.length;
  $("cardsCount").textContent = state.flashcards.length;

  const todaySeconds = state.sessions
    .filter(item => item.date === dateKey())
    .reduce((sum, item) => sum + item.seconds, 0);

  $("todayTime").textContent = formatDuration(todaySeconds);
}

function renderNotes() {
  const query = $("noteSearch").value.trim().toLowerCase();
  const notes = state.notes.filter(note =>
    `${note.title} ${note.subject} ${note.content}`
      .toLowerCase().includes(query)
  );

  $("notesList").innerHTML = notes.length
    ? notes.map(note => `
      <article class="item-card">
        <h3>${safeText(note.title)}</h3>
        <div class="item-meta">${safeText(note.subject || "অন্যান্য")} · ${safeText(note.date)}</div>
        <p>${safeText(note.content)}</p>
        <div class="item-actions">
          <button data-action="edit-note" data-id="${safeText(note.id)}">সম্পাদনা</button>
          <button data-action="share-note" data-id="${safeText(note.id)}">শেয়ার</button>
          <button class="delete-btn" data-action="delete-note" data-id="${safeText(note.id)}">মুছুন</button>
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">এখনো কোনো নোট নেই। নতুন নোট তৈরি করো।</div>';
}

function renderFlashcards() {
  $("flashList").innerHTML = state.flashcards.length
    ? state.flashcards.map(card => `
      <article class="item-card">
        <h3>❓ ${safeText(card.question)}</h3>
        <details>
          <summary>উত্তর দেখো</summary>
          <p>${safeText(card.answer)}</p>
        </details>
        <div class="item-actions">
          <button data-action="edit-flash" data-id="${safeText(card.id)}">সম্পাদনা</button>
          <button class="delete-btn" data-action="delete-flash" data-id="${safeText(card.id)}">মুছুন</button>
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">এখনো কোনো ফ্ল্যাশকার্ড নেই।</div>';
}

function renderPictures() {
  $("picturesList").innerHTML = state.pictures.length
    ? state.pictures.map(pic => `
      <article class="item-card">
        <h3>${safeText(pic.title)}</h3>
        <img class="saved-picture" src="${pic.data}" alt="${safeText(pic.title)}">
        <div class="item-actions">
          <button data-action="rename-picture" data-id="${safeText(pic.id)}">নাম পরিবর্তন</button>
          <button data-action="share-picture" data-id="${safeText(pic.id)}">শেয়ার / ডাউনলোড</button>
          <button class="delete-btn" data-action="delete-picture" data-id="${safeText(pic.id)}">মুছুন</button>
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">এখনো কোনো ছবি সংরক্ষণ করা হয়নি।</div>';
}

function renderExams() {
  const exams = [...state.exams].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  $("examsList").innerHTML = exams.length
    ? exams.map(exam => {
      const distance = new Date(exam.date).getTime() - Date.now();
      let countdown = "পরীক্ষার সময় পেরিয়ে গেছে";

      if (distance > 0) {
        const total = Math.floor(distance / 1000);
        const days = Math.floor(total / 86400);
        const hours = Math.floor((total % 86400) / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;

        countdown = `${days} দিন ${hours} ঘণ্টা ${minutes} মিনিট ${seconds} সেকেন্ড`;
      }

      return `
        <article class="item-card">
          <h3>${safeText(exam.title)}</h3>
          <p>⏳ ${safeText(countdown)}</p>
          <div class="item-meta">${safeText(new Date(exam.date).toLocaleString("bn-BD"))}</div>
          <div class="item-actions">
            <button class="delete-btn" data-action="delete-exam" data-id="${safeText(exam.id)}">মুছুন</button>
          </div>
        </article>
      `;
    }).join("")
    : '<div class="empty-state">এখনো কোনো পরীক্ষার রুটিন যোগ করা হয়নি।</div>';
}

function renderHistory() {
  const grouped = {};

  for (const session of state.sessions) {
    const key = `${session.date}|||${session.subject}`;
    grouped[key] = (grouped[key] || 0) + session.seconds;
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

function renderAll() {
  applyTheme();
  renderDashboard();
  renderNotes();
  renderFlashcards();
  renderPictures();
  renderExams();
  renderHistory();
}

$("saveNameBtn").addEventListener("click", async () => {
  state.name = $("userName").value.trim();
  await saveState();
  renderDashboard();
  notify("তোমার নাম সংরক্ষণ করা হয়েছে।");
});

$("themeBtn").addEventListener("click", async () => {
  state.settings.theme =
    state.settings.theme === "dark" ? "light" : "dark";
  await saveState();
  applyTheme();
});

$("saveNoteBtn").addEventListener("click", async () => {
  const title = $("noteTitle").value.trim();
  const content = $("noteContent").value.trim();
  const subject = $("noteSubject").value.trim();

  if (!title || !content) {
    return notify("নোটের নাম ও লেখা দুটোই পূরণ করো।");
  }

  state.notes.unshift({
    id: makeId(),
    title,
    subject,
    content,
    date: new Date().toLocaleString("bn-BD")
  });

  await saveState();

  $("noteTitle").value = "";
  $("noteSubject").value = "";
  $("noteContent").value = "";

  renderAll();
  notify("নোট সংরক্ষণ করা হয়েছে।");
});

$("noteSearch").addEventListener("input", renderNotes);

$("saveFlashBtn").addEventListener("click", async () => {
  const question = $("flashQuestion").value.trim();
  const answer = $("flashAnswer").value.trim();

  if (!question || !answer) {
    return notify("প্রশ্ন ও উত্তর দুটোই লেখো।");
  }

  state.flashcards.unshift({ id: makeId(), question, answer });
  await saveState();

  $("flashQuestion").value = "";
  $("flashAnswer").value = "";

  renderAll();
  notify("ফ্ল্যাশকার্ড সংরক্ষণ করা হয়েছে।");
});

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

  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  state.pictures.unshift({
    id: makeId(),
    title: title || file.name,
    data
  });

  try {
    await saveState();
  } catch {
    state.pictures.shift();
    return notify("স্টোরেজে জায়গা কম থাকতে পারে। ডেটা Export করে কিছু জায়গা খালি করো।");
  }

  $("pictureTitle").value = "";
  $("pictureFile").value = "";
  renderAll();
  notify("ছবি সংরক্ষণ করা হয়েছে।");
});

$("saveExamBtn").addEventListener("click", async () => {
  const title = $("examTitle").value.trim();
  const date = $("examDate").value;

  if (!title || !date || Number.isNaN(new Date(date).getTime())) {
    return notify("পরীক্ষার নাম ও সঠিক তারিখ দাও।");
  }

  if (new Date(date).getTime() <= Date.now()) {
    return notify("ভবিষ্যতের তারিখ নির্বাচন করো।");
  }

  state.exams.push({ id: makeId(), title, date });
  await saveState();

  $("examTitle").value = "";
  $("examDate").value = "";

  renderAll();
  notify("পরীক্ষার রুটিন সংরক্ষণ করা হয়েছে।");
});

function updateTimerDisplay() {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  $("timerDisplay").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerRunning = false;
}

async function finishSession() {
  stopTimer();

  if (currentSession) {
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - sessionStartedAt) / 1000)
    );

    const seconds = Math.min(currentSession.plannedSeconds, elapsed);

    if (seconds > 0) {
      state.sessions.push({
        id: makeId(),
        subject: currentSession.subject,
        seconds,
        date: dateKey()
      });

      await saveState();
    }
  }

  currentSession = null;
  sessionStartedAt = null;
  renderAll();

  $("timerMessage").textContent = "সেশন শেষ! ভালো কাজ করেছো।";
  notify("ফোকাস সেশন শেষ হয়েছে।");
}

$("focusMinutes").addEventListener("change", () => {
  if (timerRunning) return;
  const minutes = Math.max(1, Math.min(300, Number($("focusMinutes").value) || 25));
  $("focusMinutes").value = minutes;
  remainingSeconds = minutes * 60;
  updateTimerDisplay();
});

$("startTimerBtn").addEventListener("click", () => {
  if (timerRunning) return;

  if (remainingSeconds <= 0) {
    remainingSeconds = Math.max(
      1,
      Math.min(300, Number($("focusMinutes").value) || 25)
    ) * 60;
  }

  if (!currentSession) {
    currentSession = {
      subject: $("studySubject").value.trim() || "অন্যান্য",
      plannedSeconds: remainingSeconds
    };
    sessionStartedAt = Date.now();
  }

  timerRunning = true;
  $("timerMessage").textContent = "মনোযোগ দিয়ে পড়তে থাকো!";

  timerInterval = setInterval(async () => {
    if (remainingSeconds > 0) {
      remainingSeconds--;
      updateTimerDisplay();
    }

    if (remainingSeconds <= 0) {
      await finishSession();
    }
  }, 1000);
});

$("pauseTimerBtn").addEventListener("click", () => {
  if (!timerRunning) return;

  stopTimer();
  $("timerMessage").textContent = "টাইমার বিরতিতে আছে।";
});

$("resetTimerBtn").addEventListener("click", () => {
  stopTimer();
  currentSession = null;
  sessionStartedAt = null;

  remainingSeconds = Math.max(
    1,
    Math.min(300, Number($("focusMinutes").value) || 25)
  ) * 60;

  updateTimerDisplay();
  $("timerMessage").textContent = "টাইমার রিসেট হয়েছে।";
});

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
    notify("এই ব্রাউজারে সরাসরি শেয়ার করা যাচ্ছে না।");
  }
}

async function sharePicture(pic) {
  try {
    const response = await fetch(pic.data);
    const blob = await response.blob();
    const file = new File([blob], `${pic.title}.png`, {
      type: blob.type || "image/png"
    });

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: pic.title });
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${pic.title}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    notify("ছবিটি শেয়ার করা যায়নি।");
  }
}

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "delete-note") {
    if (!confirm("এই নোটটি মুছবে?")) return;
    state.notes = state.notes.filter(item => item.id !== id);
  }

  if (action === "edit-note") {
    const note = state.notes.find(item => item.id === id);
    if (!note) return;

    const title = prompt("নোটের নতুন নাম:", note.title);
    if (title === null) return;

    const content = prompt("নোটের লেখা:", note.content);
    if (content === null) return;

    note.title = title.trim() || note.title;
    note.content = content;
  }

  if (action === "share-note") {
    const note = state.notes.find(item => item.id === id);
    if (note) {
      await shareText(note.title, `${note.subject}\n${note.content}`);
    }
    return;
  }

  if (action === "delete-flash") {
    if (!confirm("এই ফ্ল্যাশকার্ডটি মুছবে?")) return;
    state.flashcards = state.flashcards.filter(item => item.id !== id);
  }

  if (action === "edit-flash") {
    const card = state.flashcards.find(item => item.id === id);
    if (!card) return;

    const question = prompt("নতুন প্রশ্ন:", card.question);
    if (question === null) return;

    const answer = prompt("নতুন উত্তর:", card.answer);
    if (answer === null) return;

    card.question = question.trim() || card.question;
    card.answer = answer;
  }

  if (action === "rename-picture") {
    const pic = state.pictures.find(item => item.id === id);
    if (!pic) return;

    const title = prompt("ছবির নতুন নাম:", pic.title);
    if (title !== null && title.trim()) pic.title = title.trim();
  }

  if (action === "share-picture") {
    const pic = state.pictures.find(item => item.id === id);
    if (pic) await sharePicture(pic);
    return;
  }

  if (action === "delete-picture") {
    if (!confirm("এই ছবিটি মুছবে?")) return;
    state.pictures = state.pictures.filter(item => item.id !== id);
  }

  if (action === "delete-exam") {
    if (!confirm("এই পরীক্ষার রুটিনটি মুছবে?")) return;
    state.exams = state.exams.filter(item => item.id !== id);
  }

  await saveState();
  renderAll();
});

$("exportBtn").addEventListener("click", async () => {
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

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mastermind-study-backup.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("importBtn").addEventListener("click", () => {
  $("importFile").click();
});

$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  if (!file) return;

  try {
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

    if (!confirm("বর্তমান ডেটার বদলে ব্যাকআপের ডেটা বসবে। চালিয়ে যাবে?")) {
      return;
    }

    state = {
      ...structuredClone(DEFAULTS),
      ...incoming,
      settings: {
        ...structuredClone(DEFAULTS.settings),
        ...(incoming.settings || {})
      }
    };

    await saveState();
    renderAll();
    notify("ব্যাকআপ Import সম্পন্ন হয়েছে।");
  } catch {
    notify("ব্যাকআপ ফাইলটি সঠিক নয় বা পড়া যায়নি।");
  } finally {
    $("importFile").value = "";
  }
});

$("pdfBtn").addEventListener("click", async () => {
  const file = $("pictureFile").files[0];

  if (!file || !file.type.startsWith("image/")) {
    return notify("প্রথমে ছবির অংশে একটি ছবি নির্বাচন করো।");
  }

  notify("এই ফিচারের জন্য পরবর্তী ধাপে অফলাইন PDF লাইব্রেরি যুক্ত করতে হবে।");
});

function hashPin(pin) {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pin)
  ).then(buffer =>
    Array.from(new Uint8Array(buffer))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("")
  );
}

function askPin(title, text) {
  return new Promise(resolve => {
    const dialog = $("appDialog");
    $("dialogTitle").textContent = title;
    $("dialogText").textContent = text;
    $("dialogInput").value = "";

    const input = $("dialogInput");
    const confirmButton = $("dialogConfirm");
    const cancelButton = $("dialogCancel");

    const cleanup = () => {
      confirmButton.removeEventListener("click", onConfirm);
      cancelButton.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
    };

    const onConfirm = event => {
      event.preventDefault();
      const value = input.value;
      cleanup();
      dialog.close();
      resolve(value);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    confirmButton.addEventListener("click", onConfirm);
    cancelButton.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);

    dialog.showModal();
    input.focus();
  });
}

$("lockBtn").addEventListener("click", async () => {
  const existing = state.settings.pinHash;

  if (existing) {
    const currentPin = await askPin(
      "অ্যাপ লক",
      "বর্তমান PIN দাও। লক বন্ধ করতে ফাঁকা PIN ব্যবহার করতে পারো।"
    );

    if (currentPin === null) return;

    if (await hashPin(currentPin) !== existing) {
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

  await saveState();
  notify(state.settings.pinHash ? "অ্যাপ লক চালু হয়েছে।" : "অ্যাপ লক বন্ধ হয়েছে।");
});

$("developerBtn").addEventListener("click", () => {
  const message = $("developerMessage");
  message.hidden = !message.hidden;
});

$("deleteAllBtn").addEventListener("click", async () => {
  if (!confirm("সতর্কতা: সব নোট, ছবি, ফ্ল্যাশকার্ড, রুটিন ও পড়ার হিসাব মুছে যাবে। আগে ডেটা Export করে রেখেছো?")) {
    return;
  }

  if (!confirm("শেষবার নিশ্চিত হও: সব অ্যাপ ডেটা স্থায়ীভাবে মুছে ফেলবে?")) {
    return;
  }

  stopTimer();
  currentSession = null;
  sessionStartedAt = null;
  state = structuredClone(DEFAULTS);

  await deleteDB("appState");
  renderAll();

  remainingSeconds = 1500;
  updateTimerDisplay();

  notify("অ্যাপের সব ডেটা মুছে ফেলা হয়েছে।");
});

async function initialize() {
  try {
    db = await openDatabase();

    const saved = await readDB("appState");
    if (saved && typeof saved === "object") {
      state = {
        ...structuredClone(DEFAULTS),
        ...saved,
        settings: {
          ...structuredClone(DEFAULTS.settings),
          ...(saved.settings || {})
        }
      };
    }

    renderAll();
    updateTimerDisplay();

    if (state.settings.pinHash) {
      lockUntil = Date.now() + 15000;
      document.body.inert = true;

      const pin = await askPin(
        "স্বাগতম",
        "অ্যাপ আনলক করতে তোমার PIN দাও।"
      );

      if (pin && await hashPin(pin) === state.settings.pinHash) {
        document.body.inert = false;
      } else {
        document.body.inert = false;
        notify("PIN সঠিক নয়। অ্যাপ লক সেটিংস থেকে আবার চেষ্টা করো।");
      }
    }
  } catch (error) {
    console.error(error);
    notify("ডেটাবেস চালু করা যায়নি। অনুগ্রহ করে আধুনিক ব্রাউজার ব্যবহার করো।");
  }
}

setInterval(() => {
  if (state.exams.length) renderExams();
}, 1000);

initialize();
