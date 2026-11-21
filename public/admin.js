const $ = id => document.getElementById(id);

let participantsCache = [];

async function api(url, options = {}) {
  const r = await fetch(url, options);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Permintaan gagal");
  return d;
}

$("loginBtn").onclick = async () => {
  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({password: $("password").value})
    });

    $("login").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    load();
  } catch (e) {
    $("loginError").textContent = e.message;
  }
};

async function load() {
  try {
    const rows = await api("/api/admin/results");

const ranking = await api("/api/admin/leaderboard");

$("leaderboard").innerHTML = ranking.length
  ? `<table>
      <thead>
        <tr><th>RANK</th><th>NAMA</th><th>KELAS</th><th>NILAI</th></tr>
      </thead>
      <tbody>
        ${ranking.map(r => `
          <tr>
            <td>${r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}</td>
            <td>${esc(r.name)}</td>
            <td>${esc(r.class_name)}</td>
            <td><strong>${r.score}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>`
  : "Belum ada peserta.";


    $("results").innerHTML = rows.length
      ? `<table>
          <thead><tr>
            <th>ID</th><th>Nama</th><th>Kelas</th>
            <th>Nilai</th><th>Dikirim</th><th>Aksi</th>
          </tr></thead>
          <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.id}</td>
              <td>${esc(r.name)}</td>
              <td>${esc(r.class_name)}</td>
              <td>${r.score}</td>
              <td>${new Date(r.submitted_at).toLocaleString("id-ID")}</td>
              <td>
                <button class="danger delete-one" data-id="${r.id}">
                  HAPUS
                </button>
              </td>
            </tr>
          `).join("")}
          </tbody>
        </table>`
      : "Belum ada peserta mengumpulkan.";

    const events = await api("/api/admin/events");

    $("events").innerHTML = events.length
      ? events.map(e =>
          `<div class="resultrow">
            Percobaan #${e.attempt_id ?? "-"} ·
            ${esc(e.event_type)} ·
            ${new Date(e.created_at).toLocaleString("id-ID")}
          </div>`
        ).join("")
      : "Belum ada catatan aktivitas.";

    const participants = await api("/api/admin/participants");
    participantsCache = participants;

    $("participantSelect").innerHTML =
      '<option value="">-- PILIH PESERTA --</option>' +
      participants.map((r, i) =>
        `<option value="${i}">${esc(r.name)} · ${esc(r.class_name)}</option>`
      ).join("");

    const history = await api("/api/admin/login-history");

    $("loginHistory").innerHTML = history.length
      ? `<div class="resultrow">
          ${history.map(r => `
            <div>
              ADMIN LOGIN · ${new Date(r.logged_in_at).toLocaleString("id-ID")}
            </div>
          `).join("")}
        </div>`
      : "Belum ada riwayat login.";


  } catch (e) {
    $("results").textContent = e.message;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

$("results").addEventListener("click", async e => {
  const btn = e.target.closest(".delete-one");
  if (!btn) return;

  const id = btn.dataset.id;

  if (!confirm("Hapus nilai peserta ID " + id + "?")) return;

  try {
    await api("/api/admin/results/" + encodeURIComponent(id) + "/delete", {
      method: "POST"
    });
    alert("Nilai peserta berhasil dihapus.");
    load();
  } catch (err) {
    alert(err.message);
  }
});

$("clearAll").onclick = async () => {
  const first = confirm(
    "PERINGATAN! Semua nilai, log aktivitas, dan draft ujian akan dihapus. Lanjutkan?"
  );

  if (!first) return;

  const second = prompt('Ketik HAPUS SEMUA untuk konfirmasi.');

  if (second !== "HAPUS SEMUA") {
    alert("Penghapusan dibatalkan.");
    return;
  }

  try {
    await api("/api/admin/clear-test-data", {method: "POST"});
    alert("Semua data ujian berhasil dibersihkan.");
    load();
  } catch (e) {
    alert(e.message);
  }
};

function logout() {
  api("/api/admin/logout", {method: "POST"})
    .then(() => location.reload())
    .catch(e => alert(e.message));
}

$("logout").onclick = logout;


/* DELETE PARTICIPANT HANDLER */
$("deletePerson").onclick = async () => {
  const select = $("participantSelect");
  if (select.value === "") {
    alert("Pilih peserta terlebih dahulu.");
    return;
  }

  const person = participantsCache[Number(select.value)];
  if (!person) {
    alert("Data peserta tidak ditemukan. Muat ulang halaman.");
    return;
  }

  const confirmation = confirm(
    `Hapus semua hasil dan draft milik ${person.name} (${person.class_name})?`
  );

  if (!confirmation) return;

  try {
    const result = await api("/api/admin/participants/delete", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: person.name,
        class_name: person.class_name
      })
    });

    alert(
      `Data peserta dihapus.\nHasil: ${result.deleted_attempts}\nDraft: ${result.deleted_drafts}`
    );
    await load();
  } catch (e) {
    alert(e.message);
  }
};

/* CLEAR LOGIN HISTORY HANDLER */
$("clearLoginHistory").onclick = async () => {
  if (!confirm("Hapus seluruh riwayat login admin? Sesi aktif tetap berjalan.")) {
    return;
  }

  try {
    await api("/api/admin/login-history/delete", {method: "POST"});
    alert("Riwayat login berhasil dihapus.");
    await load();
  } catch (e) {
    alert(e.message);
  }
};
