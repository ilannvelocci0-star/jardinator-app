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
  -- Ouvriers affectés au chantier. Un tableau : une taille de haie se
  -- fait souvent à deux ou trois. Chacun d'eux voit la fiche ; un
  -- chantier sans personne n'est visible que du patron.
  assignes       uuid[] not null default '{}',
  cree_le        timestamptz not null default now(),
  maj_le         timestamptz not null default now()
);

-- Colonnes ajoutées après coup : permet de rejouer ce fichier sur une
-- base déjà créée sans repartir de zéro.
alter table public.chantiers
  add column if not exists assignes uuid[] not null default '{}';

-- Reprise de l'ancienne colonne « un seul ouvrier », si elle existe.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'chantiers'
                and column_name = 'assigne_a') then
    update public.chantiers
       set assignes = array[assigne_a]
     where assigne_a is not null and assignes = '{}';
    alter table public.chantiers drop column assigne_a;
  end if;
end $$;

-- Index GIN : c'est ce qui rend « auth.uid() = any(assignes) » rapide.
create index if not exists chantiers_assignes_idx on public.chantiers using gin (assignes);

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

-- Le rôle est lu dans app_metadata, PAS dans user_metadata : un
-- utilisateur peut modifier lui-même son user_metadata via l'API et
-- s'auto-promouvoir. app_metadata n'est modifiable qu'en SQL ou avec la
-- clé de service.
create or replace function public.est_patron()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'ouvrier') = 'patron'
$$;

drop policy if exists "chantiers authentifies" on public.chantiers;
drop policy if exists "chantiers lecture"      on public.chantiers;
drop policy if exists "chantiers creation"     on public.chantiers;
drop policy if exists "chantiers modification" on public.chantiers;
drop policy if exists "chantiers suppression"  on public.chantiers;

-- Le patron voit tout. L'ouvrier ne voit QUE les chantiers où il figure
-- — le filtrage est fait ici, par la base : impossible de voir les
-- chantiers d'un collègue en trafiquant l'application.
create policy "chantiers lecture" on public.chantiers
  for select to authenticated
  using (public.est_patron() or auth.uid() = any (assignes));

-- Même périmètre en écriture : notes, statut et signature de fin de
-- chantier, uniquement sur ses propres chantiers.
--
-- Le with check porte sur la ligne APRÈS modification : un ouvrier ne
-- peut donc pas se retirer de la liste, ni réaffecter le chantier à
-- quelqu'un d'autre. Seul le patron redistribue.
create policy "chantiers modification" on public.chantiers
  for update to authenticated
  using (public.est_patron() or auth.uid() = any (assignes))
  with check (public.est_patron() or auth.uid() = any (assignes));

-- Créer et supprimer une fiche client reste au patron. Une fausse manip
-- d'un ouvrier ne doit pas effacer un chantier facturé.
create policy "chantiers creation" on public.chantiers
  for insert to authenticated with check (public.est_patron());

create policy "chantiers suppression" on public.chantiers
  for delete to authenticated using (public.est_patron());

-- ----------------------------------------------------------------
-- L'équipe, pour le menu déroulant « Assigné à »
-- ----------------------------------------------------------------
-- La table auth.users n'est pas interrogeable depuis l'app. Cette vue
-- n'expose que le strict nécessaire : identifiant, prénom et rôle.
-- Ni mot de passe, ni jeton, ni e-mail, ni date de connexion.
--
-- Elle tourne volontairement avec les droits de son propriétaire
-- (security definer, le défaut) : « authenticated » n'a aucun droit sur
-- auth.users, donc en security_invoker la vue échouerait pour tout le
-- monde. C'est ce qui rend le choix des colonnes ci-dessous important.
create or replace view public.equipe as
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data ->> 'nom', ''),
    initcap(split_part(u.email, '@', 1))
  ) as nom,
  coalesce(u.raw_app_meta_data ->> 'role', 'ouvrier') as role
from auth.users u;

revoke all on public.equipe from anon;
grant select on public.equipe to authenticated;

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

-- ================================================================
-- À LANCER APRÈS AVOIR CRÉÉ LES COMPTES
-- ================================================================
-- Remplacez les adresses par les vraies, puis exécutez ce bloc seul
-- (sélectionnez-le et faites Run).
--
-- Sans ça, TOUT LE MONDE est ouvrier — y compris Lucas, qui ne pourrait
-- alors ni créer ni supprimer de chantier.
-- ----------------------------------------------------------------

-- Le patron
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"patron"}'::jsonb
 where email in ('lucas@example.fr');          -- <== l'adresse de Lucas

-- Les ouvriers
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"ouvrier"}'::jsonb
 where email in ('axel@example.fr', 'bastien@example.fr',
                 'valentin@example.fr', 'moussa@example.fr');

-- Prénoms affichés dans le menu « Assigné à ». Facultatif : sans ça,
-- c'est la partie avant le @ de l'adresse qui est utilisée.
update auth.users set raw_user_meta_data =
       coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nom', v.nom)
  from (values
    ('lucas@example.fr',    'Lucas'),
    ('axel@example.fr',     'Axel'),
    ('bastien@example.fr',  'Bastien'),
    ('valentin@example.fr', 'Valentin'),
    ('moussa@example.fr',   'Moussa')
  ) as v(mail, nom)
 where auth.users.email = v.mail;

-- Vérification : doit lister 1 patron et 4 ouvriers.
-- select nom, role from public.equipe order by role, nom;
