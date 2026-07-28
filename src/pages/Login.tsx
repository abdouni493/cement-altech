import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Truck, Lock, User, Eye, EyeOff, UserPlus, Sun, Moon, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { useThemeStore } from '@/store/themeStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useSettingsStore } from '@/store/settingsStore';
import { LogoBadge } from '@/components/shared/LogoBadge';
import { hydrateFromSupabase } from '@/lib/sync';

const floatingIcons = Array.from({ length: 12 }).map((_, i) => ({
  id: i,
  left: `${(i * 8.5 + 5) % 95}%`,
  top: `${(i * 13 + 7) % 90}%`,
  size: 20 + (i % 4) * 12,
  delay: i * 0.4,
  duration: 6 + (i % 5),
}));

export default function Login() {
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useThemeStore();
  const login = useAuthStore((s) => s.login);
  const loginAsDemo = useAuthStore((s) => s.loginAsDemo);
  const createAccount = useAuthStore((s) => s.createAccount);
  const store = useSettingsStore((s) => s.settings);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  // Admin Account Creation state
  const [isRegistering, setIsRegistering] = useState(false);
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Signs in against Supabase Auth, then loads every module from the database.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await login({ identifier, password });
      if (ok) {
        await hydrateFromSupabase();
        toast.success(t('welcome') + ' 👋');
        navigate('/dashboard');
      } else {
        setShake(true);
        setTimeout(() => setShake(false), 500);
        toast.error(t('invalidCredentials'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDemoLogin = async () => {
    setBusy(true);
    try {
      await loginAsDemo();
      await hydrateFromSupabase();
      toast.success('Bienvenue ! Connecté en tant que Compte Démo Administrateur 🚀');
      navigate('/dashboard');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName || !regUsername || !regEmail || !regPassword) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }
    if (regPassword.length < 6) {
      toast.error('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }
    const res = await createAccount({
      name: regName,
      username: regUsername,
      email: regEmail,
      password: regPassword,
    });
    if (res.ok) {
      toast.success('Compte Administrateur créé avec succès ! Connectez-vous.');
      setIdentifier(regUsername);
      setPassword(regPassword);
      setIsRegistering(false);
      setRegName('');
      setRegUsername('');
      setRegEmail('');
      setRegPassword('');
    } else {
      toast.error(res.error || 'Erreur lors de la création du compte');
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-hero flex items-center justify-center p-4 relative overflow-hidden">
      {/* Floating background icons */}
      {floatingIcons.map((f) => {
        const IconComponent = f.id % 2 === 0 ? Building2 : Truck;
        return (
          <motion.div
            key={f.id}
            className="absolute text-gold/20 pointer-events-none"
            style={{ left: f.left, top: f.top }}
            animate={{ y: [0, -30, 0], rotate: [0, 15, 0], opacity: [0.1, 0.25, 0.1] }}
            transition={{ duration: f.duration, delay: f.delay, repeat: Infinity, ease: 'easeInOut' }}
          >
            <IconComponent size={f.size} />
          </motion.div>
        );
      })}

      {/* Language & Theme selector */}
      <div className="absolute top-5 right-5 z-20 flex gap-2">
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Mode Clair' : 'Mode Sombre'}
          className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-white/10 backdrop-blur-md border border-gold/30 text-text-primary hover:bg-gold/20 flex items-center gap-1.5"
        >
          {theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-indigo-500" />}
        </button>
        <button
          onClick={() => setLanguage('fr')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            language === 'fr' ? 'bg-gold text-black font-bold shadow-lg' : 'bg-vanilla/30 text-white hover:bg-black/50'
          }`}
        >
          🇫🇷 FR
        </button>
        <button
          onClick={() => setLanguage('ar')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            language === 'ar' ? 'bg-gold text-black font-bold shadow-lg' : 'bg-vanilla/30 text-white hover:bg-black/50'
          }`}
        >
          🇩🇿 AR
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 30 }}
        animate={shake ? { x: [0, -10, 10, -10, 10, -6, 6, 0] } : { opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="glass rounded-3xl shadow-2xl p-8 border-2 border-gold/30">
          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <motion.div
              initial={{ rotate: -20, scale: 0 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="mb-3"
            >
              <LogoBadge size={68} icon={36} />
            </motion.div>
            <h1 className="font-display text-2xl font-bold text-text-primary text-center">{store.name}</h1>
            <p className="text-sm text-text-muted">{store.description}</p>
          </div>

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              label="Identifiant / Email *"
              icon={<User size={18} />}
              placeholder={t('emailOrUsername')}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
            <Input
              label="Mot de passe *"
              icon={<Lock size={18} />}
              type={showPwd ? 'text' : 'password'}
              placeholder={t('password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              suffix={
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="text-text-muted hover:text-gold">
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            <Button
              type="submit"
              variant="gold"
              size="lg"
              disabled={busy}
              className="w-full font-bold shadow-gold disabled:opacity-70"
            >
              {busy ? 'Connexion…' : t('login')}
            </Button>
          </form>

          {/* Quick Demo Login Button */}
          <div className="mt-4">
            <Button
              type="button"
              variant="liver"
              size="lg"
              disabled={busy}
              className="w-full font-bold flex items-center justify-center gap-2 shadow-md border border-amber-500/40 hover:scale-[1.01] disabled:opacity-70"
              onClick={handleDemoLogin}
            >
              <Sparkles size={18} className="text-amber-400 animate-pulse" />
              Connexion avec Compte Démo
            </Button>
          </div>

          {/* Create Admin Account Button */}
          <div className="mt-6 pt-4 border-t border-gold/15 text-center">
            <button
              type="button"
              onClick={() => setIsRegistering(true)}
              className="text-xs font-semibold text-gold hover:underline inline-flex items-center gap-1.5"
            >
              <UserPlus size={14} /> Créer un compte Administrateur
            </button>
          </div>
        </div>
      </motion.div>

      {/* Modal: Create Admin Account */}
      <Modal open={isRegistering} onClose={() => setIsRegistering(false)} title="Créer un Compte Administrateur" size="sm">
        <form onSubmit={handleCreateAdmin} className="space-y-4">
          <Input
            label="Nom Complet *"
            value={regName}
            onChange={(e) => setRegName(e.target.value)}
            placeholder="Ex: Ahmed Benali"
            required
          />
          <Input
            label="Nom d'utilisateur *"
            value={regUsername}
            onChange={(e) => setRegUsername(e.target.value)}
            placeholder="Ex: admin"
            required
          />
          <Input
            label="Adresse Email *"
            type="email"
            value={regEmail}
            onChange={(e) => setRegEmail(e.target.value)}
            placeholder="admin@cementstore.com"
            required
          />
          <Input
            label="Mot de Passe *"
            type="password"
            value={regPassword}
            onChange={(e) => setRegPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-gold/10">
            <Button type="button" variant="secondary" onClick={() => setIsRegistering(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="gold">
              Créer Administrateur
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
