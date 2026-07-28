import { useAuthStore } from '@/store/authStore';
import type { PermissionModule } from '@/types';

type Action = 'view' | 'create' | 'edit' | 'delete' | 'pay';

export function usePermissions() {
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.role === 'admin' || user?.permissions === 'all';

  const can = (module: PermissionModule, action: Action = 'view'): boolean => {
    if (isAdmin) return true;
    if (!user || user.permissions === 'all') return !!isAdmin;
    const perms = user.permissions[module];
    if (!perms) return false;
    return !!perms[action];
  };

  const canView = (module: PermissionModule) => can(module, 'view');

  return { can, canView, isAdmin };
}
