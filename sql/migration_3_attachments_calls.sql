-- Migración 3: adjuntos (imágenes, archivos, notas de voz) y llamadas.
-- Ejecuta esto en Supabase: SQL Editor > New query > pega y "Run".

alter table messages
  add column if not exists attachment jsonb;

-- Requiere que el texto pueda ir vacío cuando el mensaje es solo un
-- adjunto sin comentario.
alter table messages
  alter column text drop not null;

-- Bucket de Storage para los adjuntos. Es privado (public=false): nadie
-- puede acceder a un archivo sin una URL firmada de corta duración que
-- genera nuestro backend. Si por alguna razón esta línea no crea el bucket
-- (a veces Supabase requiere hacerlo desde el dashboard), ve a
-- Storage > New bucket, nómbralo "attachments", y déjalo NO público.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Señalización de llamadas (audio/video 1 a 1). Los mensajes de
-- señalización (offer/answer/candidate/hangup) son efímeros: se leen una
-- vez y se pueden limpiar después.
create table if not exists call_signals (
  id bigint generated always as identity primary key,
  from_user text not null references users(username),
  to_user text not null references users(username),
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table call_signals enable row level security;
