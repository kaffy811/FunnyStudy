-- Humor style preference check: participants compare two captions for the same
-- image that differ only in humor style, then optionally leave feedback.
-- Kept separate from studies, caption_votes and completion stats.

create table public.humor_styles (
  id smallint primary key,
  slug text not null unique,
  name text not null,
  description text not null
);

alter table public.humor_styles enable row level security;
revoke all on public.humor_styles from public, anon, authenticated;
grant select on public.humor_styles to authenticated;
create policy "Authenticated users can read humor styles"
  on public.humor_styles for select to authenticated using (true);

insert into public.humor_styles (id, slug, name, description) values
  (1, 'playful', 'Playful', 'Light, energetic, exaggerated fun.'),
  (2, 'sarcastic', 'Sarcastic', 'Says the opposite of what it means, with an eye-roll.'),
  (3, 'absurd', 'Absurd', 'Takes the scene somewhere logically impossible.'),
  (4, 'deadpan', 'Deadpan', 'Flat, matter-of-fact delivery of something ridiculous.'),
  (5, 'wholesome', 'Wholesome', 'Warm and kind; the joke is on no one.');

-- Curated pairs. Caption text lives here (not in captions) so these controlled
-- stimuli never enter caption feeds, likes or study statistics.
create table public.style_comparison_pairs (
  id bigint generated always as identity primary key,
  image_id uuid not null references public.images(id) on delete cascade,
  image_url text not null,
  style_a_id smallint not null references public.humor_styles(id),
  caption_a text not null check (char_length(caption_a) between 1 and 300),
  style_b_id smallint not null references public.humor_styles(id),
  caption_b text not null check (char_length(caption_b) between 1 and 300),
  is_active boolean not null default true,
  created_datetime_utc timestamptz not null default statement_timestamp(),
  constraint style_comparison_pairs_distinct_styles check (style_a_id <> style_b_id)
);

alter table public.style_comparison_pairs enable row level security;
revoke all on public.style_comparison_pairs from public, anon, authenticated;
grant select on public.style_comparison_pairs to authenticated;
create policy "Authenticated users can read active style pairs"
  on public.style_comparison_pairs for select to authenticated using (is_active);
create policy "Superadmins can read all style pairs"
  on public.style_comparison_pairs for select to authenticated
  using (public.is_superadmin((select auth.uid())));

create type public.style_preference_choice as enum ('a', 'b', 'neither', 'no_preference');

-- Append-only: a changed answer is a new row; the latest row per pair counts.
create table public.style_preference_responses (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pair_id bigint not null references public.style_comparison_pairs(id) on delete cascade,
  choice public.style_preference_choice not null,
  a_shown_first boolean not null,
  time_to_choose_ms integer check (time_to_choose_ms between 0 and 86400000),
  input_method public.study_vote_input_method not null,
  created_datetime_utc timestamptz not null default statement_timestamp()
);

create index style_preference_responses_profile_pair_idx
  on public.style_preference_responses(profile_id, pair_id, created_datetime_utc desc);

alter table public.style_preference_responses enable row level security;
revoke all on public.style_preference_responses from public, anon, authenticated;
grant select on public.style_preference_responses to authenticated;
grant insert (profile_id, pair_id, choice, a_shown_first, time_to_choose_ms, input_method)
  on public.style_preference_responses to authenticated;
create policy "Participants can read their style preferences"
  on public.style_preference_responses for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "Superadmins can read style preferences"
  on public.style_preference_responses for select to authenticated
  using (public.is_superadmin((select auth.uid())));
create policy "Participants can record their style preferences"
  on public.style_preference_responses for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (select 1 from public.style_comparison_pairs p where p.id = pair_id and p.is_active)
  );

-- One optional feedback record per participant. Personalization consent is
-- separate, defaults to false and records the wording version it refers to.
create table public.style_preference_feedback (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  liked_style_ids smallint[] not null default '{}',
  disliked_style_ids smallint[] not null default '{}',
  comment text check (char_length(comment) <= 500),
  personalization_consent boolean not null default false,
  consent_version text,
  created_datetime_utc timestamptz not null default statement_timestamp(),
  modified_datetime_utc timestamptz not null default statement_timestamp(),
  constraint style_preference_feedback_style_ids check (
    liked_style_ids <@ array[1, 2, 3, 4, 5]::smallint[]
    and disliked_style_ids <@ array[1, 2, 3, 4, 5]::smallint[]
    and not (liked_style_ids && disliked_style_ids)
  ),
  constraint style_preference_feedback_consent_version check (
    not personalization_consent or consent_version is not null
  )
);

alter table public.style_preference_feedback enable row level security;
revoke all on public.style_preference_feedback from public, anon, authenticated;
grant select on public.style_preference_feedback to authenticated;
grant insert (profile_id, liked_style_ids, disliked_style_ids, comment, personalization_consent, consent_version),
  update (profile_id, liked_style_ids, disliked_style_ids, comment, personalization_consent, consent_version)
  on public.style_preference_feedback to authenticated;
create policy "Participants can read their style feedback"
  on public.style_preference_feedback for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "Superadmins can read style feedback"
  on public.style_preference_feedback for select to authenticated
  using (public.is_superadmin((select auth.uid())));
create policy "Participants can add their style feedback"
  on public.style_preference_feedback for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "Participants can update their style feedback"
  on public.style_preference_feedback for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create function public.stamp_style_preference_feedback_modified()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.modified_datetime_utc := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.stamp_style_preference_feedback_modified() from public, anon, authenticated;
create trigger stamp_style_preference_feedback_modified
  before update on public.style_preference_feedback
  for each row execute function public.stamp_style_preference_feedback_modified();

-- Seed: 12 controlled pairs on Study 122 teaching images. Every style pairing
-- appears once (10), plus playful/sarcastic and sarcastic/wholesome again as
-- consistency checks. Images missing from this database are skipped.
insert into public.style_comparison_pairs (image_id, image_url, style_a_id, caption_a, style_b_id, caption_b)
select i.id, i.url, v.style_a, v.caption_a, v.style_b, v.caption_b
from (values
  ('d2de2e99-48e2-4608-ab60-8b3f8846a3b4'::uuid, 1::smallint, 'Me hyping up my roommate for her first 8am like it''s the Olympics.', 2::smallint, 'Me telling my roommate her first 8am will be "totally fine, actually."'),
  ('4a87bca0-80ca-4187-ab80-8b6488df2f63'::uuid, 2::smallint, 'Oh sure, a perfect 10 for our group project. I definitely did more than show up.', 4::smallint, 'Group project scores are in. I attended one meeting. We got a 10.'),
  ('3c63d67c-a51c-445d-a3f7-3d2ae1b9d06e'::uuid, 1::smallint, 'Me and my best friend celebrating that the dining hall finally restocked iced coffee.', 3::smallint, 'Me and my best friend performing the ancient ritual that summons dining hall iced coffee.'),
  ('6d7b1741-af21-4c26-9453-9e6815870e67'::uuid, 5::smallint, 'My study group showing up for each other the night before finals.', 2::smallint, 'My study group, ready to discuss literally anything except the final.'),
  ('289852f6-151c-4c56-b00d-93cb4668f86d'::uuid, 4::smallint, 'Us after six flights of stairs because the elevator is "under maintenance" again.', 5::smallint, 'Us after six flights of stairs, still glad we chose to be roommates.'),
  ('10d2d689-cb62-4dca-b820-f495f5c0134b'::uuid, 3::smallint, 'Two aliens reuniting after one got stuck in the course registration portal for 400 years.', 5::smallint, 'Me hugging my best friend after we both got into the class we wanted.'),
  ('0aaa872c-6337-4b09-96d5-7723fe2bdc0d'::uuid, 1::smallint, 'Me watching my friend explain his foolproof plan to wake up for a 9am.', 4::smallint, 'My friend explaining his plan to wake up for a 9am. He has never woken up for a 9am.'),
  ('e15ae616-4a4b-4ecd-852e-03b9700b1412'::uuid, 3::smallint, 'The seven people who secretly run the campus group chat, holding their annual press conference.', 2::smallint, 'My group chat calling an emergency press conference because someone left them on read.'),
  ('35041fe8-eb7d-4bb5-a294-9f23ee26b68e'::uuid, 4::smallint, 'Local deer asked about the new campus parking policy. Deer has no comment.', 3::smallint, 'Local deer gives an exclusive interview on why he is switching his major to economics.'),
  ('e872391b-df0e-479f-8da8-43e9a8ac93cf'::uuid, 1::smallint, 'Me and my roommate doing our full routine when our song comes on at the party.', 5::smallint, 'Me and my roommate: a little ridiculous, completely in sync since day one.'),
  ('4644f76e-09d3-4b22-b8c9-a9a8aaaeab0b'::uuid, 2::smallint, 'My whole floor pretending not to watch me carry my laundry past them for the third time.', 5::smallint, 'My whole floor checking in on me after I said I was "fine" in the group chat.'),
  ('804893fd-b74b-4f9a-bba6-d00818ee4784'::uuid, 1::smallint, 'Me and my date posing like we didn''t just meet at the formal''s coat check.', 2::smallint, 'Me and my date posing like this isn''t our first and only conversation.')
) as v(image_id, style_a, caption_a, style_b, caption_b)
join public.images i on i.id = v.image_id
where i.url is not null;
