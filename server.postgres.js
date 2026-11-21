require("dotenv").config();

const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../fael-exam-neon.env")
});

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { Pool } = require("pg");

if (
  !process.env.ADMIN_PASSWORD ||
  !process.env.SESSION_SECRET ||
  !process.env.DATABASE_URL
) {
  console.error("Konfigurasi admin, session, atau database belum tersedia.");
  process.exit(1);
}

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  max: 5
});

pool.on("error", error => {
  console.error("Kesalahan database:", error.message);
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));

app.use(session({
  name: "fodz_exam_admin",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 2 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

const readQuestions = () => require("./questions.json");

const publicQuestions = () => readQuestions().map(q => ({
  id: q.id,
  question: q.question,
  options: q.options
}));

const adminOnly = (req, res, next) =>
  req.session && req.session.admin
    ? next()
    : res.status(401).json({ error: "Login admin diperlukan." });

function normalizedName(name) {
  return name.trim().toLocaleLowerCase("id-ID");
}

async function getDraft(id) {
  const result = await pool.query(
    "SELECT * FROM drafts WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

function draftResponse(draft) {
  return {
    attemptId: draft.id,
    name: draft.name,
    className: draft.class_name,
    questions: JSON.parse(draft.questions),
    answers: JSON.parse(draft.answers),
    warnings: draft.warnings,
    lockedUntil: Number(draft.locked_until)
  };
}

app.post("/api/start", async (req, res) => {
  const { name, className } = req.body || {};

  if (
    typeof name !== "string" ||
    typeof className !== "string" ||
    !name.trim() ||
    !["TRII F", "TRII E"].includes(className)
  ) {
    return res.status(400).json({
      error: "Nama dan kelas harus diisi dengan benar."
    });
  }

  const cleanName = name.trim();

  if (cleanName.length > 100) {
    return res.status(400).json({ error: "Nama terlalu panjang." });
  }

  try {
    const existing = await pool.query(
      `SELECT * FROM drafts
       WHERE LOWER(name) = LOWER($1) AND class_name = $2
       LIMIT 1`,
      [cleanName, className]
    );

    if (existing.rows.length) {
      return res.json(draftResponse(existing.rows[0]));
    }

    const submitted = await pool.query(
      `SELECT id FROM attempts
       WHERE LOWER(name) = LOWER($1) AND class_name = $2
       LIMIT 1`,
      [cleanName, className]
    );

    if (submitted.rows.length) {
      return res.status(409).json({
        error: "Peserta dengan nama dan kelas tersebut sudah mengikuti ujian."
      });
    }

    const questions = readQuestions()
      .map(q => ({ ...q }))
      .sort(() => Math.random() - 0.5);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO drafts
       (id, name, class_name, questions, answers, warnings,
        locked_until, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,0,0,$6,$6)
       RETURNING *`,
      [
        id,
        cleanName,
        className,
        JSON.stringify(questions),
        "{}",
        now
      ]
    );

    return res.json(draftResponse(result.rows[0]));
  } catch (error) {
    console.error("Gagal memulai ujian:", error.message);
    return res.status(500).json({ error: "Gagal memulai ujian." });
  }
});

app.get("/api/state/:id", async (req, res) => {
  try {
    const draft = await getDraft(req.params.id);

    if (!draft) {
      return res.status(404).json({ error: "Sesi ujian tidak ditemukan." });
    }

    return res.json(draftResponse(draft));
  } catch (error) {
    console.error("Gagal mengambil sesi:", error.message);
    return res.status(500).json({ error: "Gagal mengambil sesi ujian." });
  }
});

app.post("/api/answer", async (req, res) => {
  const { attemptId, questionId } = req.body || {};
  const answer = req.body?.answer ?? req.body?.value;

  if (
    typeof attemptId !== "string" ||
    !Number.isInteger(questionId) ||
    !["A", "B", "C", "D", "E"].includes(answer)
  ) {
    return res.status(400).json({ error: "Data jawaban tidak valid." });
  }

  try {
    const draft = await getDraft(attemptId);

    if (!draft) {
      return res.status(404).json({ error: "Sesi ujian tidak ditemukan." });
    }

    if (Number(draft.locked_until) > Date.now()) {
      return res.status(423).json({
        error: "Sesi masih terkunci.",
        lockedUntil: Number(draft.locked_until)
      });
    }

    const questions = JSON.parse(draft.questions);
    const exists = questions.some(q => q.id === questionId);

    if (!exists) {
      return res.status(400).json({ error: "Nomor soal tidak valid." });
    }

    const answers = JSON.parse(draft.answers);
    answers[questionId] = answer;

    await pool.query(
      `UPDATE drafts
       SET answers = $1, updated_at = $2
       WHERE id = $3`,
      [JSON.stringify(answers), new Date().toISOString(), attemptId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Gagal menyimpan jawaban:", error.message);
    return res.status(500).json({ error: "Gagal menyimpan jawaban." });
  }
});



app.post("/api/violation", async (req, res) => {
  const { attemptId, eventType } = req.body || {};

  const allowedEvents = [
    "tab-hidden",
    "app-switch",
    "pagehide",
    "fullscreen-exit"
  ];

  if (
    typeof attemptId !== "string" ||
    !allowedEvents.includes(eventType)
  ) {
    return res.status(400).json({ error: "Data pelanggaran tidak valid." });
  }

  try {
    const draft = await getDraft(attemptId);

    if (!draft) {
      return res.status(404).json({ error: "Sesi ujian tidak ditemukan." });
    }

    const currentTime = Date.now();
    const existingLock = Number(draft.locked_until || 0);

    if (existingLock > currentTime) {
      return res.status(423).json({
        error: "Sesi masih terkunci.",
        lockedUntil: existingLock,
        message: "Sesi masih dalam penguncian."
      });
    }

    const lockedUntil = currentTime + 20000;
    const warnings = Number(draft.warnings || 0) + 1;

    await pool.query(
      `UPDATE drafts
       SET warnings = $1, locked_until = $2, updated_at = $3
       WHERE id = $4`,
      [warnings, lockedUntil, new Date().toISOString(), attemptId]
    );

    await pool.query(
      `INSERT INTO events (attempt_id, event_type, created_at)
       VALUES (NULL, $1, $2)`,
      [eventType, new Date().toISOString()]
    );

    return res.json({
      success: true,
      warnings,
      lockedUntil,
      message: "PELANGGARAN TERDETEKSI. SESI DIKUNCI SELAMA 20 DETIK."
    });
  } catch (error) {
    console.error("Gagal mencatat pelanggaran:", error.message);
    return res.status(500).json({
      error: "Gagal memproses pelanggaran."
    });
  }
});

// ==========================================
// CYBEREUDZ // ADMIN AUTHENTICATION
// ==========================================

app.post("/api/admin/login", async (req, res) => {
  const password = req.body?.password || "";
  const a = Buffer.from(String(password));
  const b = Buffer.from(process.env.ADMIN_PASSWORD || "");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Password admin salah." });
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_login_history (
        id BIGSERIAL PRIMARY KEY,
        logged_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(
      "INSERT INTO admin_login_history DEFAULT VALUES"
    );

    req.session.admin = true;
    return res.json({ success: true });
  } catch (error) {
    console.error("Gagal mencatat login admin:", error.message);
    return res.status(500).json({
      error: "Gagal mencatat login admin."
    });
  }
});

app.post("/api/admin/logout", adminOnly, (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ==========================================
// ==========================================
// FODZ // ADMIN PARTICIPANT MANAGEMENT
// ==========================================

app.get("/api/admin/participants", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name, class_name
      FROM (
        SELECT name, class_name FROM attempts
        UNION
        SELECT name, class_name FROM drafts
      ) participants
      ORDER BY class_name, name
    `);

    return res.json(result.rows);
  } catch (error) {
    console.error("Gagal mengambil peserta:", error.message);
    return res.status(500).json({ error: "Gagal mengambil daftar peserta." });
  }
});

app.post("/api/admin/participants/delete", adminOnly, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const className = String(req.body?.class_name || "").trim();

  if (!name || !className) {
    return res.status(400).json({ error: "Nama dan kelas wajib diisi." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const drafts = await client.query(
      "DELETE FROM drafts WHERE LOWER(name) = LOWER($1) AND class_name = $2",
      [name, className]
    );

    const attempts = await client.query(
      "DELETE FROM attempts WHERE LOWER(name) = LOWER($1) AND class_name = $2",
      [name, className]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      deleted_attempts: attempts.rowCount,
      deleted_drafts: drafts.rowCount
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Gagal menghapus peserta:", error.message);
    return res.status(500).json({ error: "Gagal menghapus data peserta." });
  } finally {
    client.release();
  }
});

app.get("/api/admin/login-history", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, logged_in_at FROM admin_login_history ORDER BY id DESC LIMIT 100"
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Gagal mengambil riwayat login:", error.message);
    return res.status(500).json({ error: "Gagal mengambil riwayat login." });
  }
});

app.post("/api/admin/login-history/delete", adminOnly, async (req, res) => {
  try {
    await pool.query("DELETE FROM admin_login_history");
    return res.json({ ok: true });
  } catch (error) {
    console.error("Gagal menghapus riwayat login:", error.message);
    return res.status(500).json({ error: "Gagal menghapus riwayat login." });
  }
});

// CYBEREUDZ // ADMIN RESULTS
// ==========================================

app.get("/api/admin/results", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM attempts ORDER BY id DESC"
    );

    return res.json(result.rows.map(row => ({
      ...row,
      answers: JSON.parse(row.answers || "{}")
    })));
  } catch (error) {
    console.error("Gagal mengambil hasil:", error.message);
    return res.status(500).json({
      error: "Gagal mengambil hasil peserta."
    });
  }
});

// ==========================================
// CYBEREUDZ // ADMIN LEADERBOARD
// ==========================================

app.get("/api/admin/leaderboard", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, class_name, score, total, submitted_at
      FROM attempts
      ORDER BY score DESC, submitted_at ASC, id ASC
    `);

    return res.json(result.rows.map((row, index) => ({
      rank: index + 1,
      ...row
    })));
  } catch (error) {
    console.error("Leaderboard gagal:", error.message);
    return res.status(500).json({
      error: "Gagal mengambil leaderboard."
    });
  }
});

// ==========================================
// CYBEREUDZ // ADMIN LEADERBOARD


// ==========================================
// CYBEREUDZ // SUBMIT DAN PENILAIAN UJIAN
// ==========================================

app.post("/api/submit", async (req, res) => {
  const { attemptId } = req.body || {};

  if (typeof attemptId !== "string" || !attemptId) {
    return res.status(400).json({
      error: "ID ujian tidak valid."
    });
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const draftResult = await client.query(
      "SELECT * FROM drafts WHERE id = $1 FOR UPDATE",
      [attemptId]
    );

    const draft = draftResult.rows[0];

    if (!draft) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({
        error: "Data ujian tidak ditemukan."
      });
    }

    if (Number(draft.locked_until || 0) > Date.now()) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(423).json({
        error: "Ujian masih dikunci."
      });
    }

    const qs = readQuestions();
    const answers = JSON.parse(draft.answers || "{}");

    if (qs.length !== 20 || qs.some(q => !q.answer)) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(500).json({
        error: "Kunci soal belum lengkap."
      });
    }

    let correct = 0;
    const cleanAnswers = {};

    for (const q of qs) {
      const value = answers[String(q.id)];

      if (["A", "B", "C", "D", "E"].includes(value)) {
        cleanAnswers[q.id] = value;
      }

      if (value === q.answer) correct++;
    }

    const score = Math.round((correct / qs.length) * 100);

    const result = await client.query(`
      INSERT INTO attempts
        (name, class_name, answers, score, total, warnings, submitted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      draft.name,
      draft.class_name,
      JSON.stringify(cleanAnswers),
      score,
      qs.length,
      draft.warnings,
      new Date().toISOString()
    ]);

    await client.query(
      "DELETE FROM drafts WHERE id = $1",
      [attemptId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      ok: true,
      score,
      total: qs.length,
      correct,
      attemptId: Number(result.rows[0].id)
    });

  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Submit ujian gagal:", error.message);

    return res.status(500).json({
      error: "Ujian gagal dikumpulkan atau disimpan."
    });

  } finally {
    client.release();
  }
});

// ==========================================
// CYBEREUDZ // EVENT MONITORING
// ==========================================

app.post("/api/event", async (req, res) => {
  const { eventType } = req.body || {};
  const allowed = ["copy-attempt", "context-menu"];

  if (!allowed.includes(eventType)) {
    return res.status(400).json({
      error: "Event tidak dikenal."
    });
  }

  try {
    await pool.query(`
      INSERT INTO events (attempt_id, event_type, created_at)
      VALUES (NULL, $1, $2)
    `, [
      eventType,
      new Date().toISOString()
    ]);

    return res.json({ ok: true });

  } catch (error) {
    console.error("Pencatatan event gagal:", error.message);

    return res.status(500).json({
      error: "Gagal mencatat aktivitas."
    });
  }
});

// ==========================================
// CYBEREUDZ // ADMIN EVENT HISTORY
// ==========================================

app.get("/api/admin/events", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM events
      ORDER BY id DESC
      LIMIT 500
    `);

    return res.json(result.rows);

  } catch (error) {
    console.error("Gagal mengambil aktivitas:", error.message);

    return res.status(500).json({
      error: "Gagal mengambil riwayat aktivitas."
    });
  }
});

// ==========================================
// CYBEREUDZ // ADMIN EXPORT CSV
// ==========================================

app.get("/api/admin/export.csv", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name, class_name, score, total, warnings, submitted_at
      FROM attempts
      ORDER BY id DESC
    `);

    const esc = value =>
      '"' + String(value ?? "").replace(/"/g, '""') + '"';

    const csv = [
      "Nama,Kelas,Nilai,Total,Peringatan,Waktu pengumpulan",
      ...result.rows.map(row =>
        [
          row.name,
          row.class_name,
          row.score,
          row.total,
          row.warnings,
          row.submitted_at
        ].map(esc).join(",")
      )
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="CYBEREUDZ-Hasil-Ujian.csv"'
    );

    return res.send("\uFEFF" + csv);

  } catch (error) {
    console.error("Export CSV gagal:", error.message);

    return res.status(500).json({
      error: "Gagal mengekspor hasil ujian."
    });
  }
});

// ==========================================
// CYBEREUDZ // ADMIN EXPORT EXCEL
// ==========================================

app.get("/api/admin/export.xlsx", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, class_name, answers, score, total,
             warnings, submitted_at
      FROM attempts
      ORDER BY score DESC, submitted_at ASC, id ASC
    `);

    const rows = result.rows;
    const workbook = new ExcelJS.Workbook();

    workbook.creator = "CYBEREUDZ";

    const sheet = workbook.addWorksheet("Rekap Peserta");

    sheet.columns = [
      { header: "Peringkat", key: "rank", width: 12 },
      { header: "ID", key: "id", width: 8 },
      { header: "Nama", key: "name", width: 25 },
      { header: "Kelas", key: "class_name", width: 14 },
      { header: "Nilai", key: "score", width: 12 },
      { header: "Total Soal", key: "total", width: 12 },
      { header: "Peringatan", key: "warnings", width: 13 },
      { header: "Waktu Pengumpulan", key: "submitted_at", width: 25 },
      ...Array.from({ length: 20 }, (_, i) => ({
        header: "Soal " + (i + 1),
        key: "q" + (i + 1),
        width: 10
      }))
    ];

    rows.forEach((r, index) => {
      let answers = {};

      try {
        answers = JSON.parse(r.answers || "{}");
      } catch {}

      const row = {
        rank: index + 1,
        id: r.id,
        name: r.name,
        class_name: r.class_name,
        score: r.score,
        total: r.total,
        warnings: r.warnings,
        submitted_at: r.submitted_at
      };

      for (let i = 1; i <= 20; i++) {
        row["q" + i] = answers[String(i)] || "-";
      }

      sheet.addRow(row);
    });

    sheet.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" }
    };

    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8B0000" }
    };

    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: "AB1" };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="CYBEREUDZ-Rekap-Ujian.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error("Export Excel gagal:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Gagal membuat file Excel."
      });
    } else {
      res.end();
    }
  }
});

// ==========================================
// CYBEREUDZ // ADMIN DELETE PESERTA
// ==========================================

app.post("/api/admin/results/:id/delete", adminOnly, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({
      error: "ID peserta tidak valid."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "DELETE FROM events WHERE attempt_id = $1",
      [id]
    );

    const result = await client.query(
      "DELETE FROM attempts WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Peserta tidak ditemukan."
      });
    }

    await client.query("COMMIT");

    return res.json({ ok: true });

  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Hapus peserta gagal:", error.message);

    return res.status(500).json({
      error: "Gagal menghapus peserta."
    });

  } finally {
    client.release();
  }
});

// ==========================================
// CYBEREUDZ // ADMIN CLEAR TEST DATA
// ==========================================

app.post("/api/admin/clear-test-data", adminOnly, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM events");
    await client.query("DELETE FROM drafts");
    await client.query("DELETE FROM attempts");
    await client.query("DELETE FROM admin_login_history");

    await client.query("COMMIT");

    return res.json({
      ok: true,
      message: "Seluruh data ujian berhasil dibersihkan."
    });

  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Pembersihan data gagal:", error.message);

    return res.status(500).json({
      error: "Gagal membersihkan data."
    });

  } finally {
    client.release();
  }
});

// ==========================================
// CYBEREUDZ // SERVER START
// ==========================================

const port = Number(process.env.PORT || 3000);

const server = app.listen(port, "0.0.0.0", () => {
  console.log("==================================");
  console.log(" CYBEREUDZ // POSTGRESQL SYSTEM");
  console.log("==================================");
  console.log(`Server berjalan di port ${port}`);
});

async function shutdown() {
  console.log("Menutup koneksi CYBEREUDZ...");
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
