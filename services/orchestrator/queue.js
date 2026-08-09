// M5 — Tabla-cola SQL (ADR-004): enqueue, claim atómico, reintentos con backoff,
// dead-letter. Sin broker externo: transaccional sobre el mismo SQLite (osint.db).
export function migrateQueue(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo         TEXT NOT NULL,            -- ingest | entity-res | views | ...
      payload      TEXT,                     -- JSON
      dedupe_key   TEXT,                     -- colapsa duplicados mientras haya uno vivo
      estado       TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|corriendo|ok|muerto
      intentos     INTEGER NOT NULL DEFAULT 0,
      max_intentos INTEGER NOT NULL DEFAULT 3,
      run_after    TEXT,                     -- backoff: no reclamar antes de esta hora
      creado_en    TEXT NOT NULL,
      iniciado_en  TEXT, terminado_en TEXT,
      error        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(estado, run_after, job_id);
    -- un solo job vivo por dedupe_key (los terminados no bloquean re-encolar)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe
      ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND estado IN ('pendiente','corriendo');
  `);
}

const BACKOFF_BASE_MS = 30_000; // 30 s · 60 s · 120 s …

export class Queue {
  constructor(db) {
    this.db = db;
    migrateQueue(db);
  }

  /** Encola un trabajo. Devuelve job_id, o null si dedupe_key ya tiene un job vivo. */
  enqueue({ tipo, payload = null, dedupeKey = null, maxIntentos = 3, runAfter = null }) {
    try {
      const r = this.db.prepare(`
        INSERT INTO jobs (tipo, payload, dedupe_key, max_intentos, run_after, creado_en)
        VALUES (?,?,?,?,?,?)
      `).run(tipo, payload ? JSON.stringify(payload) : null, dedupeKey, maxIntentos, runAfter, new Date().toISOString());
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return null; // ya encolado
      throw e;
    }
  }

  /** Claim atómico del job pendiente más viejo cuyo backoff ya venció. */
  claim(now = new Date().toISOString()) {
    const row = this.db.prepare(`
      UPDATE jobs SET estado='corriendo', intentos=intentos+1, iniciado_en=?
      WHERE job_id = (
        SELECT job_id FROM jobs
        WHERE estado='pendiente' AND (run_after IS NULL OR run_after<=?)
        ORDER BY job_id LIMIT 1
      )
      RETURNING *
    `).get(now, now);
    if (!row) return null;
    return { ...row, payload: row.payload ? JSON.parse(row.payload) : null };
  }

  complete(jobId) {
    this.db.prepare("UPDATE jobs SET estado='ok', terminado_en=?, error=NULL WHERE job_id=?")
      .run(new Date().toISOString(), jobId);
  }

  /** Reintento con backoff exponencial; agotados los intentos → dead-letter ('muerto'). */
  fail(jobId, err, now = Date.now()) {
    const job = this.db.prepare("SELECT intentos, max_intentos FROM jobs WHERE job_id=?").get(jobId);
    if (!job) return "missing";
    const msg = String(err?.message ?? err).slice(0, 500);
    if (job.intentos >= job.max_intentos) {
      this.db.prepare("UPDATE jobs SET estado='muerto', terminado_en=?, error=? WHERE job_id=?")
        .run(new Date(now).toISOString(), msg, jobId);
      return "muerto";
    }
    const backoff = BACKOFF_BASE_MS * 2 ** (job.intentos - 1);
    this.db.prepare("UPDATE jobs SET estado='pendiente', run_after=?, error=? WHERE job_id=?")
      .run(new Date(now + backoff).toISOString(), msg, jobId);
    return "reintento";
  }

  /** Jobs 'corriendo' huérfanos (proceso muerto a mitad) vuelven a 'pendiente'. */
  recoverStale(olderThanMs = 15 * 60_000, now = Date.now()) {
    return this.db.prepare(`
      UPDATE jobs SET estado='pendiente'
      WHERE estado='corriendo' AND iniciado_en < ?
    `).run(new Date(now - olderThanMs).toISOString()).changes;
  }

  stats() {
    return this.db.prepare(
      "SELECT estado, COUNT(*) n FROM jobs GROUP BY estado ORDER BY estado"
    ).all();
  }

  deadLetter(limit = 20) {
    return this.db.prepare(
      "SELECT job_id, tipo, payload, intentos, error, terminado_en FROM jobs WHERE estado='muerto' ORDER BY job_id DESC LIMIT ?"
    ).all(limit);
  }
}
