import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  LogIn,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import CustomerPortal from './CustomerPortal';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'admin' | 'cliente'>(() =>
    localStorage.getItem('customer_portal_token') ? 'cliente' : 'admin',
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCustomerPortal = () => {
    setError('');
    setMode('cliente');
  };

  if (mode === 'cliente') {
    return <CustomerPortal onBackToAdmin={() => setMode('admin')} />;
  }

  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-slate-950 [WebkitOverflowScrolling:touch]">
      <div className="mx-auto grid min-h-[100dvh] max-w-7xl lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.34),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.19),_transparent_42%)]" />

          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
              <Store size={28} aria-hidden="true" />
            </div>

            <p className="mt-8 text-xs font-black uppercase tracking-[0.28em] text-indigo-200">
              Edugestión
            </p>
            <h1 className="mt-4 max-w-xl text-4xl font-black leading-tight xl:text-5xl">
              Tu negocio, organizado y bajo control.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
              Administrá ventas, productos, clientes, compras y finanzas desde un solo lugar, con acceso seguro para cada integrante del equipo.
            </p>
          </div>

          <div className="relative grid gap-3 sm:grid-cols-3">
            {[
              { icon: BarChart3, label: 'Información en tiempo real' },
              { icon: PackageCheck, label: 'Operación centralizada' },
              { icon: ShieldCheck, label: 'Accesos por permisos' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
              >
                <item.icon size={20} className="text-sky-300" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-slate-100">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
                <Store size={24} aria-hidden="true" />
              </div>
              <div>
                <p className="font-black text-slate-950">Edugestión</p>
                <p className="text-xs font-bold text-slate-500">Acceso administrativo</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/10 sm:p-8">
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5" aria-label="Tipo de acceso">
                <button
                  type="button"
                  onClick={() => setMode('admin')}
                  aria-pressed="true"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-slate-950 shadow-sm ring-1 ring-slate-200"
                >
                  <UsersRound size={17} aria-hidden="true" />
                  Administración
                </button>
                <button
                  type="button"
                  onClick={openCustomerPortal}
                  aria-pressed="false"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black text-slate-500 transition hover:bg-white/70 hover:text-indigo-700"
                >
                  <ShoppingCart size={17} aria-hidden="true" />
                  Clientes
                </button>
              </div>

              <div className="mt-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                <UserRound size={27} aria-hidden="true" />
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-indigo-600">
                  <Sparkles size={15} aria-hidden="true" />
                  Espacio de trabajo
                </div>
                <h1 className="mt-3 text-2xl font-black text-slate-950">
                  Ingresá a Edugestión
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Usá el correo y la contraseña asignados a tu usuario.
                </p>
              </div>

              {error && (
                <div
                  className="mt-5 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div>
                  <label
                    htmlFor="admin-email"
                    className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500"
                  >
                    Correo electrónico
                  </label>
                  <div className="relative">
                    <LogIn
                      size={19}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="admin-email"
                      type="email"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (error) setError('');
                      }}
                      className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      placeholder="Ingresá tu correo"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="admin-password"
                    className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500"
                  >
                    Contraseña
                  </label>
                  <div className="relative">
                    <LockKeyhole
                      size={19}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="admin-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (error) setError('');
                      }}
                      className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-12 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      placeholder="Ingresá tu contraseña"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <Loader2 size={19} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight size={19} aria-hidden="true" />
                  )}
                  {isSubmitting ? 'Ingresando…' : 'Entrar al sistema'}
                </button>
              </form>

              <div className="mt-6 flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
                <ShieldCheck size={19} className="shrink-0 text-emerald-600" aria-hidden="true" />
                <p>El acceso está protegido y respeta los permisos asignados a cada usuario.</p>
              </div>
            </div>

            <p className="mt-5 text-center text-xs font-medium text-slate-400">
              © 2026 Edugestión · Sistema de gestión comercial
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
