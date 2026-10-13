export interface CompanyAccount {
  id?: number;
  company_id: string;
  name: string;
  contact_email: string;
  contact_phone?: string;
  address?: string;
  plan_type: string;
  max_users: number;
  license_status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'PENDING';
  license_key: string;
  license_start: string;
  license_expiry: string;
  created_at: string;
  updated_at: string;
}

export interface AdminDashboardData {
  total_companies: number;
  active_companies: number;
  suspended_companies: number;
  expired_licenses: number;
  approaching_expiry: number;
  companies: CompanyAccount[];
}

export interface AuditLogItem {
  id: number;
  action: string;
  actor_admin_id: string;
  target_type: string;
  target_id: string;
  details?: string;
  ip_address?: string;
  created_at: string;
}

export interface LicenseStatusResult {
  is_licensed: boolean;
  status: 'ACTIVE' | 'OFFLINE_ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'GRACE_EXPIRED' | 'UNLICENSED' | 'INVALID' | 'TAMPERED';
  message: string;
  company?: CompanyAccount | any;
}

const TOKEN_STORAGE_KEY = 'sentinelx_admin_token';

export const adminApi = {
  getToken: (): string | null => {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  },

  setToken: (token: string) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  },

  clearToken: () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  },

  getAuthHeaders: (): HeadersInit => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  },

  // Auth
  getSetupStatus: async (): Promise<{ is_initialized: boolean; admin_count: number }> => {
    const res = await fetch('/api/admin/auth/setup-status');
    return res.json();
  },

  initialSetup: async (data: { username: string; email: string; password: string; setup_key?: string }) => {
    const res = await fetch('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, setup_key: data.setup_key || 'SETUP-ROOT' })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to complete initial setup');
    }
    return res.json();
  },

  login: async (username_or_email: string, password: string) => {
    const res = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username_or_email, password })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    if (data.token) {
      adminApi.setToken(data.token);
    }
    return data;
  },

  logout: async () => {
    try {
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: adminApi.getAuthHeaders()
      });
    } catch (_) {}
    adminApi.clearToken();
  },

  getMe: async () => {
    const res = await fetch('/api/admin/auth/me', {
      headers: adminApi.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Not authenticated');
    return res.json();
  },

  // Dashboard & Companies
  getDashboard: async (): Promise<AdminDashboardData> => {
    const res = await fetch('/api/admin/dashboard', {
      headers: adminApi.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch dashboard metrics');
    return res.json();
  },

  getCompanies: async (status?: string, search?: string): Promise<{ companies: CompanyAccount[]; count: number }> => {
    const params = new URLSearchParams();
    if (status && status !== 'ALL') params.append('status', status);
    if (search) params.append('search', search);

    const res = await fetch(`/api/admin/companies?${params.toString()}`, {
      headers: adminApi.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch companies');
    return res.json();
  },

  createCompany: async (payload: {
    name: string;
    contact_email: string;
    contact_phone?: string;
    address?: string;
    plan_type?: string;
    max_users?: number;
    validity_days?: number;
  }) => {
    const res = await fetch('/api/admin/companies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...adminApi.getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to create company');
    }
    return res.json();
  },

  updateCompanyStatus: async (companyId: string, status: string) => {
    const res = await fetch(`/api/admin/companies/${companyId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...adminApi.getAuthHeaders()
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to update status');
    }
    return res.json();
  },

  updateCompanyDetails: async (companyId: string, updates: Partial<CompanyAccount>) => {
    const res = await fetch(`/api/admin/companies/${companyId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...adminApi.getAuthHeaders()
      },
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to update company');
    }
    return res.json();
  },

  renewLicense: async (companyId: string, extendDays: number = 365) => {
    const res = await fetch(`/api/admin/companies/${companyId}/license/renew`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...adminApi.getAuthHeaders()
      },
      body: JSON.stringify({ extend_days: extendDays })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to renew license');
    }
    return res.json();
  },

  getAuditLogs: async (limit: number = 50): Promise<{ logs: AuditLogItem[]; count: number }> => {
    const res = await fetch(`/api/admin/audit-logs?limit=${limit}`, {
      headers: adminApi.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch audit logs');
    return res.json();
  },

  // Client Machine Licensing
  checkLicenseStatus: async (): Promise<LicenseStatusResult> => {
    const res = await fetch('/api/license/status');
    return res.json();
  },

  activateLicense: async (companyId: string, licenseKey: string) => {
    const res = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, license_key: licenseKey })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'License activation failed');
    }
    return res.json();
  },

  activateCloudLicense: async (companyData: Record<string, any>) => {
    const res = await fetch('/api/license/activate-cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(companyData)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Cloud license sync failed');
    }
    return res.json();
  }
};
