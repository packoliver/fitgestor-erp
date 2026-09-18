alter table public.label_templates
  add column if not exists layout text not null default 'qsf-standard',
  add column if not exists policy_text text,
  add column if not exists columns integer not null default 1,
  add column if not exists column_spacing numeric;

alter table public.label_templates
  drop constraint if exists label_templates_layout_check;
alter table public.label_templates
  add constraint label_templates_layout_check check (layout in ('compact','qsf-standard','thermal'));

alter table public.label_templates
  drop constraint if exists label_templates_columns_check;
alter table public.label_templates
  add constraint label_templates_columns_check check (columns >= 1);

comment on column public.label_templates.layout is 'Preset de desenho: compact | qsf-standard | thermal';
comment on column public.label_templates.policy_text is 'Texto de política impresso no rodapé (layout qsf-standard)';
comment on column public.label_templates.columns is 'Etiquetas por linha da bobina (1 = uma etiqueta por página)';
comment on column public.label_templates.column_spacing is 'Passo horizontal em mm entre colunas quando columns > 1';
;
