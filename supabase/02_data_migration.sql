begin;

-- Usuarios existentes
insert into users (id, name, email, password, role, avatar, active, created_at)
values
  (1, 'Administrador', 'admin@edugestion.com', '$2b$10$tYckllJNWV204vteUfWSfu8S4J2DdN4pBFHdeui9S8ZVAYIpd3NhG', 'administrador', 'AD', 1, '2026-04-16 17:12:24')
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  password = excluded.password,
  role = excluded.role,
  avatar = excluded.avatar,
  active = excluded.active,
  created_at = excluded.created_at;

-- Métodos de pago existentes
insert into payment_methods (id, name, tipo, activo)
values
  (1, 'Efectivo', 'Efectivo', 1),
  (2, 'Transferencia', 'Transferencia', 1),
  (3, 'Mercado Pago', 'Digital', 1),
  (4, 'Cta Cte', 'Crédito', 1),
  (5, 'Cheque', 'Digital', 1)
on conflict (id) do update set
  name = excluded.name,
  tipo = excluded.tipo,
  activo = excluded.activo;

-- Cliente base existente
insert into clientes (
  id, nombre_apellido, razon_social, cuit, telefono, email, direccion, localidad,
  provincia, latitud, longitud, observaciones, tipo_cliente, lista_precio,
  limite_credito, saldo_cta_cte, fecha_alta, activo
)
values (
  1, 'Consumidor Final', 'Consumidor Final', null, null, null, null, 'Local',
  null, null, null, null, 'minorista', 'lista1',
  0, 0, '2026-04-16 17:12:24', 1
)
on conflict (id) do update set
  nombre_apellido = excluded.nombre_apellido,
  razon_social = excluded.razon_social,
  cuit = excluded.cuit,
  telefono = excluded.telefono,
  email = excluded.email,
  direccion = excluded.direccion,
  localidad = excluded.localidad,
  provincia = excluded.provincia,
  latitud = excluded.latitud,
  longitud = excluded.longitud,
  observaciones = excluded.observaciones,
  tipo_cliente = excluded.tipo_cliente,
  lista_precio = excluded.lista_precio,
  limite_credito = excluded.limite_credito,
  saldo_cta_cte = excluded.saldo_cta_cte,
  fecha_alta = excluded.fecha_alta,
  activo = excluded.activo;

-- Proveedor base existente
insert into proveedores (id, nombre, cuit, telefono, email, direccion, estado)
values
  (1, 'Proveedor General', null, null, null, null, 'activo')
on conflict (id) do update set
  nombre = excluded.nombre,
  cuit = excluded.cuit,
  telefono = excluded.telefono,
  email = excluded.email,
  direccion = excluded.direccion,
  estado = excluded.estado;

-- Ajuste de secuencias
select setval(pg_get_serial_sequence('users', 'id'), greatest((select coalesce(max(id), 1) from users), 1), true);
select setval(pg_get_serial_sequence('payment_methods', 'id'), greatest((select coalesce(max(id), 1) from payment_methods), 1), true);
select setval(pg_get_serial_sequence('clientes', 'id'), greatest((select coalesce(max(id), 1) from clientes), 1), true);
select setval(pg_get_serial_sequence('proveedores', 'id'), greatest((select coalesce(max(id), 1) from proveedores), 1), true);

commit;
