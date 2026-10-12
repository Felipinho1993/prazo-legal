import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { requireAuth } from "./middleware.js";

const router = Router();
router.use(requireAuth);

const nullableText = (max) => z.string().trim().max(max).optional().default("");
const eventSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Informe o título.").max(100),
  type: z.enum(["prazo", "audiencia", "reuniao"]),
  date: z.iso.date(),
  time: z.union([z.iso.time({ precision: -1 }), z.literal("")]).optional().default(""),
  processNumber: nullableText(80),
  client: nullableText(120),
  court: nullableText(180),
  responsible: nullableText(120),
  reminder: z.coerce.number().int().min(0).max(525600).default(1440),
  notes: nullableText(2000),
  status: z.enum(["pending", "completed"]).default("pending"),
  priority: z.boolean().default(false),
});

function mapEvent(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    date: row.event_date instanceof Date ? row.event_date.toISOString().slice(0, 10) : String(row.event_date),
    time: row.event_time ? String(row.event_time).slice(0, 5) : "",
    processNumber: row.process_number || "",
    client: row.client || "",
    court: row.court || "",
    responsible: row.responsible || "",
    reminder: row.reminder_minutes,
    notes: row.notes || "",
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/", async (request, response) => {
  const result = await pool.query(
    `select * from events where user_id = $1
     order by event_date asc, event_time asc nulls last, created_at asc`,
    [request.session.user.id],
  );
  response.json({ events: result.rows.map(mapEvent) });
});

router.put("/:id", async (request, response) => {
  const parsed = eventSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    return response.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos." });
  }
  const event = parsed.data;
  const values = [
    event.id, request.session.user.id, event.title, event.type, event.date, event.time || null,
    event.processNumber || null, event.client || null, event.court || null,
    event.responsible || null, event.reminder, event.notes || null, event.status, event.priority,
  ];
  const result = await pool.query(
    `insert into events (
      id, user_id, title, type, event_date, event_time, process_number, client,
      court, responsible, reminder_minutes, notes, status, priority
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
    )
    on conflict (id) do update set
      title = excluded.title,
      type = excluded.type,
      event_date = excluded.event_date,
      event_time = excluded.event_time,
      process_number = excluded.process_number,
      client = excluded.client,
      court = excluded.court,
      responsible = excluded.responsible,
      reminder_minutes = excluded.reminder_minutes,
      notes = excluded.notes,
      status = excluded.status,
      priority = excluded.priority,
      updated_at = now()
    where events.user_id = excluded.user_id
    returning *`,
    values,
  );
  if (!result.rowCount) return response.status(404).json({ error: "Compromisso não encontrado." });
  response.json({ event: mapEvent(result.rows[0]) });
});

router.delete("/:id", async (request, response) => {
  const parsed = z.uuid().safeParse(request.params.id);
  if (!parsed.success) return response.status(400).json({ error: "Identificador inválido." });
  const result = await pool.query("delete from events where id = $1 and user_id = $2", [request.params.id, request.session.user.id]);
  if (!result.rowCount) return response.status(404).json({ error: "Compromisso não encontrado." });
  response.status(204).end();
});

export { eventSchema, mapEvent };
export default router;
