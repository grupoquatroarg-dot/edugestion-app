begin;

alter table public.clientes
  add column if not exists codigo_postal text;

comment on column public.clientes.codigo_postal is
  'Código postal textual del domicilio del cliente';

commit;
