-- ================================================================
-- JARDINATOR — Schéma Supabase
-- À coller dans : Supabase > SQL Editor > New query > Run
-- ================================================================
--
-- La clé « publishable » de l'app est publique par conception : elle
-- vit dans le HTML, lui-même dans un dépôt GitHub public. Ce qui protège
-- les données, ce sont donc UNIQUEMENT les règles RLS ci-dessous.
-- Sans elles, n'importe qui ayant la clé lirait tous les chantiers.
-- ================================================================

-- ----------------------------------------------------------------
-- Table des chantiers
-- ----------------------------------------------------------------
create table if not exists public.chantiers (
  id             text primary key,            -- 'CH-1787843285745', généré côté app
  statut         text not null default 'À faire',
  client         text not null default '',
  adresse        text not null default '',
  devis          text not null default '',    -- nom lisible du fichier
  devis_path     text,                        -- chemin dans le bucket
  consignes      text not null default '',
  notes          text not null default '',
  date_prevue    text not null default '',
  date_termine   text not null default '',
  signature_path text,
  -- [{ "path": "...", "nom": "...", "cle": "..." }]
  -- « cle » est l'identifiant local de l'appareil qui a pris la photo :
  -- il lui permet de réutiliser sa vignette au lieu de la retélécharger.
  photos         jsonb not null default '[]'::jsonb,
  cree_le        timestamptz not null default now(),
  maj_le         timestamptz not null default now()
);

create index if not exists chantiers_statut_idx on public.chantiers (statut);
create index if not exists chantiers_maj_idx    on public.chantiers (maj_le desc);

-- maj_le se met à jour tout seul : le front n'a pas à y penser.
create or replace function public.touch_maj()
returns trigger language plpgsql as $$
begin
  new.maj_le = now();
  return new;
end $$;

drop trigger if exists chantiers_touch on public.chantiers;
create trigger chantiers_touch
  before update on public.chantiers
  for each row execute function public.touch_maj();

-- ----------------------------------------------------------------
-- Sécurité : tout passe par un compte utilisateur
-- ----------------------------------------------------------------
alter table public.chantiers enable row level security;

-- Aucun accès anonyme. Seuls les comptes créés dans
-- Authentication > Users peuvent lire et écrire.
drop policy if exists "chantiers authentifies" on public.chantiers;
create policy "chantiers authentifies"
  on public.chantiers
  for all
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------
-- Stockage des photos, signatures et devis
-- ----------------------------------------------------------------
-- Bucket privé : pas d'URL publique. Les fichiers ne sont servis
-- qu'avec un jeton de session valide. Ce sont des photos de propriétés
-- privées rattachées à un nom et une adresse client.
insert into storage.buckets (id, name, public)
values ('jardinator', 'jardinator', false)
on conflict (id) do nothing;

drop policy if exists "fichiers lecture"      on storage.objects;
drop policy if exists "fichiers ecriture"     on storage.objects;
drop policy if exists "fichiers maj"          on storage.objects;
drop policy if exists "fichiers suppression"  on storage.objects;

create policy "fichiers lecture" on storage.objects
  for select to authenticated using (bucket_id = 'jardinator');

create policy "fichiers ecriture" on storage.objects
  for insert to authenticated with check (bucket_id = 'jardinator');

create policy "fichiers maj" on storage.objects
  for update to authenticated using (bucket_id = 'jardinator');

create policy "fichiers suppression" on storage.objects
  for delete to authenticated using (bucket_id = 'jardinator');
