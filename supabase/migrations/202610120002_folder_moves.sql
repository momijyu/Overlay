begin;

-- 元PDF・線・ノートの所属先は変更せず、フォルダの親だけを変更する窓口。
-- テーブルの直接UPDATE権限は増やさず、所有者と階層を確認してから更新する。
create function public.move_note_folder(moving_folder_id uuid, destination_parent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_owner uuid := auth.uid();
  creates_cycle boolean;
begin
  if request_owner is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  -- 同じ所有者による移動を順番に実行する。
  -- 別タブからA→BとB→Aが同時に送られても、後の処理で循環を検出する。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_owner::text, 0));

  if not exists (
    select 1 from public.note_folders
    where id = moving_folder_id and owner_id = request_owner
  ) then
    raise exception 'Folder is not available' using errcode = '42501';
  end if;

  if destination_parent_id is not null then
    if not exists (
      select 1 from public.note_folders
      where id = destination_parent_id and owner_id = request_owner
    ) then
      raise exception 'Destination folder is not available' using errcode = '23503';
    end if;

    -- 移動先から親をたどり、移動するフォルダが含まれていたら拒否する。
    -- UNIONで重複を除き、不正な既存データがあっても無限再帰しない。
    with recursive ancestors as (
      select id, parent_id from public.note_folders
      where id = destination_parent_id and owner_id = request_owner
      union
      select parent.id, parent.parent_id
      from public.note_folders as parent
      join ancestors on parent.id = ancestors.parent_id
      where parent.owner_id = request_owner
    )
    select exists (select 1 from ancestors where id = moving_folder_id)
    into creates_cycle;

    if creates_cycle then
      raise exception 'Folder hierarchy would contain a cycle' using errcode = '23514';
    end if;
  end if;

  update public.note_folders
  set parent_id = destination_parent_id
  where id = moving_folder_id and owner_id = request_owner;
  return moving_folder_id;
end;
$$;

revoke execute on function public.move_note_folder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.move_note_folder(uuid, uuid) to authenticated;

commit;
