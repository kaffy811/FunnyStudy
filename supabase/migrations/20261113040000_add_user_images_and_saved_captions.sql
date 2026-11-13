-- Caption-lab uploads are now kept: the resized photo goes to the private
-- `user-images` Storage bucket under the uploader's own folder, with one
-- `user_images` row per photo. Only the uploader can read their photos (the
-- app shows them through short-lived signed URLs), and they may be mixed into
-- that participant's own AI studies. Captions can be saved to Your history.

create table public.user_images (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- "<profile_id>/<uuid>.jpg" inside the user-images bucket.
  storage_path text not null unique check (char_length(storage_path) between 1 and 200),
  created_datetime_utc timestamptz not null default statement_timestamp(),
  constraint user_images_own_folder check (split_part(storage_path, '/', 1) = profile_id::text)
);

create index user_images_profile_created_idx
  on public.user_images(profile_id, created_datetime_utc desc);

alter table public.user_images enable row level security;
revoke all on public.user_images from public, anon, authenticated;
grant select, delete on public.user_images to authenticated;
grant insert (profile_id, storage_path) on public.user_images to authenticated;
create policy "Participants can read their uploaded images"
  on public.user_images for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "Superadmins can read uploaded images"
  on public.user_images for select to authenticated
  using (public.is_superadmin((select auth.uid())));
create policy "Participants can add their uploaded images"
  on public.user_images for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "Participants can delete their uploaded images"
  on public.user_images for delete to authenticated
  using (profile_id = (select auth.uid()));

-- Private bucket: 1 MB JPEG/PNG/WebP, readable and writable only in the
-- caller's own top-level folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-images', 'user-images', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Participants upload to their own user-images folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'user-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Participants read their own user-images"
  on storage.objects for select to authenticated
  using (bucket_id = 'user-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Participants delete their own user-images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'user-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Captions link to the stored photo, and can be saved to Your history.
alter table public.ai_generated_captions
  add column user_image_id uuid references public.user_images(id) on delete set null,
  add column saved_datetime_utc timestamptz;
grant insert (user_image_id), update (saved_datetime_utc)
  on public.ai_generated_captions to authenticated;

-- Only the participant's own photos may be linked to their captions.
drop policy "Participants can save their AI captions" on public.ai_generated_captions;
create policy "Participants can save their AI captions"
  on public.ai_generated_captions for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (
      session_id is null
      or exists (
        select 1 from public.ai_study_sessions s
        where s.id = session_id and s.profile_id = (select auth.uid())
      )
    )
    and (
      user_image_id is null
      or exists (
        select 1 from public.user_images u
        where u.id = user_image_id and u.profile_id = (select auth.uid())
      )
    )
  );
