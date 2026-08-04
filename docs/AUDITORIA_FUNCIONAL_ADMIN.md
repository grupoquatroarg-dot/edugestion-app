# Auditoría funcional final · EduGestión Admin

## Objetivo

Validar la aplicación administrativa y el Portal de Clientes de punta a punta sin modificar datos reales del negocio. La cuenta principal de prueba debe ser **Administrador** y debe utilizarse un cliente de prueba para el portal.

## Preparación

- [ ] Confirmar que Vercel publicó el último commit de `main`.
- [ ] Ingresar como Administrador.
- [ ] Generar un respaldo desde Configuración.
- [ ] Anotar fecha y hora de inicio.
- [ ] Usar nombres identificables, por ejemplo `PRUEBA AUDITORÍA`.
- [ ] No ejecutar reinicio total ni restauración hasta terminar todas las pruebas.

**Commit probado:** ____________________  
**URL probada:** ____________________  
**Navegador/dispositivo:** ____________________  
**Responsable:** ____________________  

## Validación técnica previa

Ejecutar desde la raíz del proyecto:

```powershell
npm run validate:audit
npm run lint
```

Resultados esperados:

- [ ] `check:encoding` finaliza sin mojibake.
- [ ] `check:audit` supera todas las comprobaciones.
- [ ] `build` finaliza correctamente.
- [ ] Se registran por separado los errores preexistentes de `lint`.

## 1. Fechas del negocio

Usar la fecha **25/06/2026** para detectar cualquier conversión UTC accidental.

- [ ] Registrar una factura de compra con fecha 25/06/2026.
- [ ] Confirmar 25/06/2026 en el listado de facturas.
- [ ] Confirmar el egreso asociado en Finanzas el 25/06/2026.
- [ ] Registrar un egreso manual con fecha 25/06/2026.
- [ ] Confirmar que no aparezca como 24/06/2026 21:00.
- [ ] Abrir Caja diaria del 25/06/2026 y verificar ambos movimientos.
- [ ] Filtrar Reportes desde y hasta 25/06/2026.
- [ ] Confirmar que Dashboard y agrupaciones diarias usen el mismo día.
- [ ] Revisar una venta o comprobante PDF con fecha del negocio correcta.

**Evidencia/observaciones:** ________________________________________________

## 2. Domicilios de clientes

### Dirección geolocalizada

- [ ] Crear `PRUEBA DIRECCIÓN CARCARAÑÁ`.
- [ ] Escribir `Av. Belgrano 123`.
- [ ] Confirmar que las primeras sugerencias prioricen Carcarañá/Santa Fe.
- [ ] Seleccionar una sugerencia.
- [ ] Confirmar localidad, provincia, CP 2138 y coordenadas.
- [ ] Guardar y revisar la ficha.

### Dirección manual sin coordenadas

- [ ] Crear `PRUEBA DIRECCIÓN MANUAL`.
- [ ] Escribir una dirección sin elegir sugerencia.
- [ ] Completar Carcarañá, Santa Fe y 2138 manualmente.
- [ ] Guardar correctamente.
- [ ] Confirmar `Dirección cargada sin coordenadas`.
- [ ] Confirmar que no muestre `Sin ubicación`.

**Evidencia/observaciones:** ________________________________________________

## 3. Producto y Cambio de precios

- [ ] Crear un producto de prueba con código `UX13458`.
- [ ] Ir a Cambio de precios sin recargar toda la aplicación.
- [ ] Buscar `UX13458`.
- [ ] Confirmar que sea la primera coincidencia.
- [ ] Seleccionarlo con clic.
- [ ] Repetir y seleccionarlo con Enter.
- [ ] Generar vista previa solo para ese producto.
- [ ] Verificar búsquedas por nombre, familia, categoría y empresa.
- [ ] Buscar un código inexistente y comprobar el mensaje útil.
- [ ] No aplicar un cambio masivo fuera de los datos de prueba.

**Evidencia/observaciones:** ________________________________________________

## 4. Estados de carga y errores

Con DevTools, seleccionar una velocidad de red lenta antes de abrir cada módulo.

- [ ] Ventas muestra skeleton y `Cargando ventas, productos y clientes...`.
- [ ] Ruta del día muestra un estado de preparación/carga.
- [ ] Checklist muestra `Cargando checklist...`.
- [ ] Cambio de precios mantiene una estructura de carga clara.
- [ ] Ninguno presenta una pantalla semivacía sin explicación.
- [ ] Simular temporalmente red sin conexión y verificar error/reintento.

**Evidencia/observaciones:** ________________________________________________

## 5. Scroll y foco

Realizar también con teclado, sin usar el mouse después de abrir cada panel.

- [ ] Nuevo cliente lleva al formulario y enfoca Nombre y apellido.
- [ ] Editar cliente lleva al formulario y enfoca Nombre y apellido.
- [ ] Ver ficha muestra el panel desde arriba y mueve el foco al encabezado.
- [ ] Cuenta corriente abre Movimientos y mueve el foco al panel.
- [ ] Registrar pago enfoca Monto a pagar.
- [ ] Al cerrar, el foco vuelve al botón que originó la apertura.

**Evidencia/observaciones:** ________________________________________________

## 6. Accesibilidad

- [ ] Recorrer Reportes con Tab.
- [ ] Cambiar pestañas con flechas izquierda/derecha, Inicio y Fin.
- [ ] Confirmar nombres completos de los reportes.
- [ ] Abrir Permisos y recorrer checkboxes con Tab.
- [ ] Confirmar nombres como `Ventas - Crear` y `Productos - Eliminar`.
- [ ] Confirmar `Cerrar panel de permisos`.
- [ ] Abrir formularios y modales de Clientes y Ventas.
- [ ] Confirmar que cada cierre identifique qué panel cierra.
- [ ] Confirmar foco visible en todo momento.
- [ ] Confirmar que inputs principales tengan labels entendibles.

**Evidencia/observaciones:** ________________________________________________

## 7. Encoding y textos

- [ ] La pestaña del navegador muestra `EduGestión`.
- [ ] Se ven correctamente `Configuración`, `Contraseña` y `Método de pago`.
- [ ] Los errores de validación muestran tildes correctas.
- [ ] No aparecen secuencias típicas de doble codificación ni caracteres de reemplazo en la interfaz.
- [ ] `npm run check:encoding` finaliza correctamente.

**Evidencia/observaciones:** ________________________________________________

## 8. Regresión de flujos principales

- [ ] Login administrador y cierre de sesión.
- [ ] Dashboard y filtros.
- [ ] Productos, stock y merma.
- [ ] Clientes y cuenta corriente.
- [ ] Venta contado.
- [ ] Venta cuenta corriente.
- [ ] Pago parcial o mixto.
- [ ] Factura de compra y proveedor.
- [ ] Pedido a proveedor.
- [ ] Finanzas, caja y cheques.
- [ ] Reportes y PDFs.
- [ ] Ruta del día completa.
- [ ] Checklist.
- [ ] Usuarios y permisos.
- [ ] Backup de Configuración.

## 9. Revocación de sesiones del Portal de Clientes

Usar un cliente de prueba, una ventana normal para Administración y una ventana privada para el Portal de Clientes.

- [ ] Habilitar el portal con un usuario y una contraseña de prueba.
- [ ] Ingresar al portal y confirmar que pedidos, productos y movimientos carguen correctamente.
- [ ] Editar únicamente un dato comercial, como la dirección, y confirmar que la sesión siga activa.
- [ ] Cambiar la contraseña del portal desde Administración.
- [ ] Actualizar la ventana del portal y confirmar que solicite iniciar sesión nuevamente.
- [ ] Confirmar que la contraseña anterior ya no funcione y que la nueva sí.
- [ ] Cambiar el nombre de usuario y confirmar que vuelva a revocarse la sesión existente.
- [ ] Deshabilitar el portal y confirmar que el acceso activo quede bloqueado inmediatamente.
- [ ] Rehabilitarlo y confirmar que solo permita entrar mediante un login nuevo.
- [ ] Verificar que varios intentos fallidos consecutivos activen el bloqueo temporal.

## Limpieza

- [ ] Eliminar o identificar claramente clientes de prueba.
- [ ] Eliminar o desactivar el producto `UX13458` si no debe permanecer.
- [ ] Revertir movimientos de prueba mediante los flujos permitidos.
- [ ] Confirmar stock, caja y cuentas corrientes finales.
- [ ] Generar un nuevo respaldo después de aprobar la prueba.

## Resultado final

- [ ] **APROBADA:** todos los criterios críticos funcionan.
- [ ] **APROBADA CON OBSERVACIONES:** no hay bloqueo operativo, pero quedan mejoras menores.
- [ ] **RECHAZADA:** existe un error que afecta datos, stock, dinero, fechas o permisos.

**Incidencias encontradas:**

1. ________________________________________________________________________
2. ________________________________________________________________________
3. ________________________________________________________________________

**Decisión y próximo paso:** ________________________________________________
