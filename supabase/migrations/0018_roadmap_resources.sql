alter table lesson_resources drop constraint lesson_resources_kind_check;
alter table lesson_resources add constraint lesson_resources_kind_check
  check (kind in ('code', 'notebook', 'paper', 'reading', 'roadmap', 'other'));