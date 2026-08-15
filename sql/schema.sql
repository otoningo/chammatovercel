-- Ejecuta esto en Supabase: Project > SQL Editor > New query > pega y "Run".
--
-- Nota de seguridad: todas las tablas quedan con RLS activado y SIN
-- políticas públicas. Eso significa que nadie puede leerlas ni escribirlas
-- usando la clave "anon" (la que sería pública si algo del navegador la
-- expusiera). Las únicas lecturas/escrituras pasan por las funciones
-- serverless de Vercel, que usan la Service Role Key — esa key nunca debe
-- ir al navegador, solo vive como variable de entorno en Vercel.

create table if not exists users (
  username text primary key,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  username text primary key references users(username) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  from_user text not null references users(username),
  text text not null,
  ts timestamptz not null default now()
);

create table if not exists push_subscriptions (
  username text primary key references users(username) on delete cascade,
  subscription jsonb not null
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table messages enable row level security;
alter table push_subscriptions enable row level security;
