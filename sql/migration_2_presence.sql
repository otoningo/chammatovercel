-- Migración 2: agrega lo necesario para presencia (en línea / última vez),
-- indicador de "escribiendo", doble check (entregado/leído), y edición de
-- mensajes. Ejecuta esto en Supabase: SQL Editor > New query > pega y "Run".
-- Es seguro correrlo aunque ya tengas datos: solo agrega columnas nuevas,
-- no toca lo que ya existe.

alter table sessions
  add column if not exists typing_at timestamptz;

alter table messages
  add column if not exists edited_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;
