const $ = id => document.getElementById(id);

// CYBERFØDZ AUTO FULLSCREEN ON FIRST TOUCH
document.addEventListener("pointerdown", function activateFullscreen() {
  if (document.fullscreenElement) return;

  if (!document.documentElement.requestFullscreen) return;

  document.documentElement.requestFullscreen({
    navigationUI: "hide"
  }).then(() => {
    document.removeEventListener("pointerdown", activateFullscreen);
    console.log("CYBERFØDZ FULLSCREEN ACTIVE");
  }).catch(() => {
    console.log("Fullscreen belum diizinkan browser.");
  });
});


let questions = [];
let identity = null;
let attemptId = null;
let answers = {};
let lockedUntil = 0;
let lastViolation = 0;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Terjadi kesalahan.");
  return data;
}

function showExam(data) {
  attemptId = data.attemptId;
  identity = { name: data.name, className: data.className };
  questions = data.questions;
  answers = data.answers || {};
  lockedUntil = data.lockedUntil || 0;

  localStorage.setItem("fodz_attempt_id", attemptId);
  localStorage.setItem("fodz_name", identity.name);
  localStorage.setItem("fodz_class", identity.className);

  $("identity").classList.add("hidden");
  $("exam").classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "instant" });

  render();
  updateLock();
}

let pendingIdentity = null;

$("start").onclick = () => {
  const name = $("name").value.trim();
  const className = $("className").value;

  if (name.length < 2 || !className) {
    alert("Isi nama dan pilih kelas terlebih dahulu.");
    return;
  }

  pendingIdentity = { name, className };
  $("security-warning").classList.remove("hidden");
};

$("confirm-warning").onclick = async () => {
  if (!pendingIdentity) return;

  const button = $("confirm-warning");
  button.disabled = true;
  button.textContent = "[ ACTIVATING SYSTEM... ]";

  let fullscreenMessage = "";

  try {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;

    if (!standalone && !document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({
          navigationUI: "hide"
        });
      } else {
        fullscreenMessage =
          "Fullscreen tidak didukung browser ini. Gunakan PWA CYBERFØDZ.";
      }
    }
  } catch (error) {
    fullscreenMessage =
      "Fullscreen tidak berhasil diaktifkan. Kamu tetap bisa melanjutkan ujian.";
  }

  button.textContent = "[ AUTHENTICATING... ]";

  try {
    const data = await request("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingIdentity)
    });

    pendingIdentity = null;
    $("security-warning").classList.add("hidden");
    showExam(data);

    if (fullscreenMessage) {
      alert(fullscreenMessage);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "[ ACKNOWLEDGE // ENTER EXAM ]";
  }
};

async function resumeExam() {
  const id = localStorage.getItem("fodz_attempt_id");
  if (!id) return;

  try {
    const data = await request("/api/state/" + encodeURIComponent(id));
    showExam(data);
  } catch (error) {
    console.log("Belum ada ujian yang bisa dilanjutkan.");
  }
}

function render() {
  const form = $("quiz");
  form.innerHTML = "";

  questions.forEach((q, i) => {
    const section = document.createElement("section");
    section.className = "question";

    const p = document.createElement("p");
    p.textContent = `${i + 1}. ${q.question}`;
    section.appendChild(p);

    Object.entries(q.options).forEach(([key, value]) => {
      const label = document.createElement("label");
      label.className = "option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = String(q.id);
      input.value = key;
      input.checked = answers[String(q.id)] === key;

      input.addEventListener("change", () => {
        saveAnswer(q.id, key);
      });

      const span = document.createElement("span");
      span.textContent = `${key}. ${value}`;

      label.append(input, span);
      section.appendChild(label);
    });

    form.appendChild(section);
  });

  $("progress").textContent =
    `${Object.keys(answers).length} dari ${questions.length} soal terjawab · Tanpa batas waktu`;
}

async function saveAnswer(questionId, value) {
  if (lockedUntil > Date.now()) return;

  answers[String(questionId)] = value;

  $("progress").textContent =
    `${Object.keys(answers).length} dari ${questions.length} soal terjawab · Menyimpan...`;

  try {
    await request("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId, questionId, value })
    });

    $("progress").textContent =
      `${Object.keys(answers).length} dari ${questions.length} soal terjawab · Tersimpan`;
} catch (error) {
    alert("Jawaban belum berhasil disimpan: " + error.message);
  }
}

$("submit").onclick = async () => {
  if (lockedUntil > Date.now()) {
    alert("Tunggu sampai masa penguncian selesai.");
    return;
  }

  const count = Object.keys(answers).length;

  if (count !== 20 &&
      !confirm(`Baru ${count} dari 20 soal dijawab. Tetap kumpulkan?`)) {
    return;
  }

  if (!confirm("Yakin ingin mengumpulkan ujian?")) return;

  $("submit").disabled = true;

  try {
    const data = await request("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId })
    });

    localStorage.removeItem("fodz_attempt_id");
    localStorage.removeItem("fodz_name");
    localStorage.removeItem("fodz_class");

    $("exam").classList.add("hidden");
    $("result").classList.remove("hidden");
    $("score").textContent =
      `Nilai: ${data.score} · Benar: ${data.correct} dari ${data.total}`;
} catch (error) {
    alert(error.message);
    $("submit").disabled = false;
  }
};

let lockTimer = null;

function updateLock() {
  if (lockTimer) clearInterval(lockTimer);

  const tick = () => {
    const remaining = Math.max(0, lockedUntil - Date.now());
    const isLocked = remaining > 0;

    document.querySelectorAll("#quiz input").forEach(input => {
      input.disabled = isLocked;
    });

    $("submit").disabled = isLocked;

    if (isLocked) {
      const seconds = Math.ceil(remaining / 1000);
      showNotice(`⚠ SECURITY LOCKDOWN // SESI TERKUNCI ${seconds} DETIK`);
    } else {
      if (lockTimer) clearInterval(lockTimer);
      lockTimer = null;
      showNotice("✓ SECURITY SYSTEM // SESI AKTIF KEMBALI");
    }
  };

  tick();

  if (lockedUntil > Date.now()) {
    lockTimer = setInterval(tick, 250);
  }
}

function showNotice(message) {
  let notice = $("notice");

  if (!notice) {
    notice = document.createElement("p");
    notice.id = "notice";
    notice.className = "muted";
    $("exam").prepend(notice);
  }

  notice.textContent = message;
}

async function reportViolation(eventType = "tab-hidden") {
  if (!attemptId || Date.now() - lastViolation < 2500) return;
  lastViolation = Date.now();

  try {
    const data = await request("/api/violation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId, eventType })
    });

    lockedUntil = data.lockedUntil || 0;
    showNotice(data.message);
    updateLock();
  } catch (error) {
    console.log(error.message);
  }
}

// Pindah tab atau aplikasi yang membuat halaman tersembunyi
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    reportViolation("tab-hidden");
  }
});

// Cadangan ketika halaman kehilangan fokus.
// Diberi jeda agar tidak langsung menghitung kehilangan fokus sesaat.
let blurCheck = null;

window.addEventListener("blur", () => {
  clearTimeout(blurCheck);

  blurCheck = setTimeout(() => {
    if (document.hidden) {
      reportViolation("app-switch");
    }
  }, 1200);
});

window.addEventListener("focus", () => {
  clearTimeout(blurCheck);
});

// Ketika halaman ditinggalkan melalui navigasi atau ditutup
window.addEventListener("pagehide", () => {
  reportViolation("pagehide");
});

// Jika peserta keluar dari fullscreen setelah sebelumnya masuk fullscreen
let wasFullscreen = Boolean(document.fullscreenElement);

document.addEventListener("fullscreenchange", () => {
  if (wasFullscreen && !document.fullscreenElement) {
    reportViolation("fullscreen-exit");
  }

  wasFullscreen = Boolean(document.fullscreenElement);
});

["copy", "cut", "paste", "contextmenu", "dragstart", "selectstart"]
  .forEach(eventName => {
    document.addEventListener(eventName, event => {
      event.preventDefault();

      if (eventName === "copy" || eventName === "contextmenu") {
        fetch("/api/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attemptId,
            eventType: eventName === "copy" ? "copy-attempt" : "context-menu"
          })
        }).catch(() => {});
      }
    });
  });

resumeExam();
