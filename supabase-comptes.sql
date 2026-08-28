-- ================================================================
-- JARDINATOR — Création des 5 comptes
-- À coller dans : Supabase > SQL Editor > New query > Run
-- ================================================================
--
-- ⚠ À LANCER APRÈS supabase-schema.sql, PAS AVANT.
--
-- Ce script crée les comptes, leur mot de passe et leur rôle en une
-- fois. Il est rejouable : relancer ne crée pas de doublon, il met à
-- jour le mot de passe et le rôle des comptes déjà présents.
--
-- MOTS DE PASSE (à transmettre aux intéressés, puis à changer) :
--   Lucas     : lucas2026
--   Axel      : axel2026
--   Bastien   : bastien2026
--   Valentin  : valentin2026
--   Moussa    : moussa2026
--
-- Ils sont volontairement simples à taper sur un téléphone de chantier.
-- Ils sont aussi devinables : quiconque connaît un prénom de l'équipe
-- peut tenter sa chance. Ils protègent des noms, adresses et photos de
-- clients. À changer via Authentication > Users dès que possible, et
-- obligatoirement le jour où quelqu'un quitte l'entreprise.
-- ================================================================

-- ⬇️ REMPLACEZ l'adresse de Lucas par la vraie : c'est la seule qui doit
--    exister, lui seul pourra recevoir un lien de réinitialisation.
--    Les autres peuvent rester telles quelles, aucun mail n'est envoyé.

create extension if not exists pgcrypto;

do $$
declare
  gens constant jsonb := '[
    {"mail":"lucas@jardinator-paysage.fr",    "nom":"Lucas",    "mdp":"lucas2026",    "role":"patron"},
    {"mail":"axel@jardinator-paysage.fr",     "nom":"Axel",     "mdp":"axel2026",     "role":"ouvrier"},
    {"mail":"bastien@jardinator-paysage.fr",  "nom":"Bastien",  "mdp":"bastien2026",  "role":"ouvrier"},
    {"mail":"valentin@jardinator-paysage.fr", "nom":"Valentin", "mdp":"valentin2026", "role":"ouvrier"},
    {"mail":"moussa@jardinator-paysage.fr",   "nom":"Moussa",   "mdp":"moussa2026",   "role":"ouvrier"}
  ]'::jsonb;
  g        jsonb;
  uid      uuid;
  existant uuid;
begin
  for g in select * from jsonb_array_elements(gens) loop

    select id into existant from auth.users where email = g->>'mail';

    if existant is not null then
      -- Compte déjà là : on remet à jour mot de passe, rôle et prénom.
      update auth.users set
        encrypted_password = crypt(g->>'mdp', gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        raw_app_meta_data  = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', g->>'role'),
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                             || jsonb_build_object('nom', g->>'nom'),
        updated_at = now()
      where id = existant;

    else
      uid := gen_random_uuid();

      -- Les colonnes de jetons doivent valoir '' et non NULL : GoTrue
      -- refuse la connexion avec une erreur de conversion sinon.
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current
      ) values (
        '00000000-0000-0000-0000-000000000000', uid,
        'authenticated', 'authenticated',
        g->>'mail', crypt(g->>'mdp', gen_salt('bf')),
        now(), now(), now(),
        jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role',g->>'role'),
        jsonb_build_object('nom', g->>'nom'),
        '', '', '', '', ''
      );

      -- Sans cette ligne, le compte existe mais la connexion par e-mail
      -- ne le trouve pas.
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', g->>'mail', 'email_verified', true),
        'email', now(), now(), now()
      );
    end if;

  end loop;
end $$;

-- Vérification : doit afficher Lucas en patron et les 4 autres en ouvrier.
select nom, role from public.equipe order by role, nom;
