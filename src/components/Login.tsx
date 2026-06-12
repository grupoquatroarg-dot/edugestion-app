import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, AlertCircle, Loader2, ShoppingCart } from 'lucide-react';
import CustomerPortal from './CustomerPortal';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<'admin' | 'cliente'>(() => localStorage.getItem('customer_portal_token') ? 'cliente' : 'admin');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (mode === 'cliente') {
    return <CustomerPortal onBackToAdmin={() => setMode('admin')} />;
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-zinc-200 overflow-hidden">
          <div className="p-8">
            <div className="grid grid-cols-2 gap-2 mb-6 bg-zinc-50 p-1 rounded-2xl">
              <button type="button" onClick={() => setMode('admin')} className="py-2 rounded-xl bg-white shadow-sm text-xs font-black uppercase tracking-widest text-zinc-900 flex items-center justify-center gap-2">
                <LogIn size={14} /> Admin
              </button>
              <button type="button" onClick={() => setMode('cliente')} className="py-2 rounded-xl text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-emerald-700 flex items-center justify-center gap-2">
                <ShoppingCart size={14} /> Cliente
              </button>
            </div>

            <div className="flex justify-center mb-8">
              <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center text-white">
                <LogIn size={32} />
              </div>
            </div>
            
            <h1 className="text-2xl font-black text-zinc-900 text-center mb-2 tracking-tight">
              EDU<span className="text-zinc-400">GESTIÓN</span>
            </h1>
            <p className="text-zinc-500 text-center mb-8 text-sm">
              Inicia sesión para acceder al sistema
            </p>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                <AlertCircle size={18} className="shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all text-sm"
                  placeholder="admin@edugestion.com"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all text-sm"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-zinc-900 text-white font-bold py-4 rounded-xl hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/10 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>
                    <LogIn size={20} />
                    Entrar
                  </>
                )}
              </button>
            </form>
          </div>
          
          <div className="bg-zinc-50 p-6 border-t border-zinc-100 text-center">
            <p className="text-xs text-zinc-400">
              © 2026 EduGestión • Sistema de Gestión Comercial
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
