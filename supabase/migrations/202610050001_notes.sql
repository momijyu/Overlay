begin;

-- 元PDFの保存場所とページごとの線データを、1つのノートとして管理する。
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  pdf_path text not null unique,
  strokes_by_page jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_pdf_path_matches_owner check (
    pdf_path = owner_id::text || '/' || id::text || '.pdf'
  ),
  constraint notes_strokes_are_object check (
    jsonb_typeof(strokes_by_page) = 'object'
  )
);

alter table public.notes enable row level security;

-- 匿名サインインにもauthenticatedロールが使われる。自分のノートだけを許可する。
create policy "notes_select_own"
on public.notes for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "notes_insert_own"
on public.notes for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "notes_update_own"
on public.notes for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on public.notes from anon;
grant select, insert, update on public.notes to authenticated;

-- PDFは公開URLで誰でも読める状態にせず、非公開バケットに置く。
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('overlay-pdfs', 'overlay-pdfs', false, array['application/pdf']);

create policy "pdfs_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'overlay-pdfs'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "pdfs_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'overlay-pdfs'
  and owner_id = (select auth.uid()::text)
);

-- 書き込み情報の保存が拒否されたとき、アップロード済みPDFの後片付けに使う。
create policy "pdfs_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'overlay-pdfs'
  and owner_id = (select auth.uid()::text)
);

commit;
