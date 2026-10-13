import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  Timestamp
} from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyAJRyxWSSzHU-a9k6VkqvHvD6RP26oTo2o",
  authDomain: "sentinelx-ai-production-6a42a.firebaseapp.com",
  projectId: "sentinelx-ai-production-6a42a",
  storageBucket: "sentinelx-ai-production-6a42a.firebasestorage.app",
  messagingSenderId: "517485853834",
  appId: "1:517485853834:web:7e75fc53398c2f371b8173",
  measurementId: "G-7RGBM2DPXW"
};

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// In-memory token holder for API requests
let currentIdToken: string | null = null;

// Track auth state and sync token
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      currentIdToken = await user.getIdToken();
    } catch (_) {
      currentIdToken = null;
    }
  } else {
    currentIdToken = null;
  }
});

export const firebaseAuthService = {
  getCurrentToken: async (): Promise<string | null> => {
    if (auth.currentUser) {
      currentIdToken = await auth.currentUser.getIdToken(true);
      return currentIdToken;
    }
    return currentIdToken;
  },

  getCurrentUser: (): User | null => {
    return auth.currentUser;
  },

  login: async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    currentIdToken = await cred.user.getIdToken();
    return cred.user;
  },

  logout: async () => {
    await signOut(auth);
    currentIdToken = null;
  },

  onStateChange: (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, callback);
  }
};

export interface CloudCompany {
  company_id: string;
  name: string;
  contact_email: string;
  contact_phone?: string;
  plan_type: string;
  license_key: string;
  license_status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  license_start: string;
  license_expiry: string;
  max_users: number;
  created_at: string;
}

export const cloudLicenseService = {
  /**
   * Validates a company license online from Firestore.
   */
  verifyLicenseOnline: async (companyId: string, licenseKey: string): Promise<{
    valid: boolean;
    message: string;
    company?: CloudCompany;
  }> => {
    try {
      const compRef = doc(db, 'companies', companyId.trim().toUpperCase());
      const snapshot = await getDoc(compRef);
      if (!snapshot.exists()) {
        return { valid: false, message: 'Company ID does not exist in SentinelX Cloud Registry.' };
      }

      const compData = snapshot.data() as CloudCompany;
      if (compData.license_key.trim() !== licenseKey.trim()) {
        return { valid: false, message: 'Invalid License Key for this Company.' };
      }

      if (compData.license_status === 'SUSPENDED') {
        return { valid: false, message: 'This company account has been suspended by SentinelX Administrator.' };
      }

      const now = new Date();
      const expiry = new Date(compData.license_expiry);
      if (now > expiry || compData.license_status === 'EXPIRED') {
        return { valid: false, message: `License expired on ${compData.license_expiry.slice(0, 10)}. Please contact Admin to renew.` };
      }

      return { valid: true, message: 'License verified successfully.', company: compData };
    } catch (e: any) {
      console.warn('Cloud license check failed:', e);
      return { valid: false, message: e.message || 'Failed to reach SentinelX License Cloud.' };
    }
  },

  /**
   * Creates a new company in Firestore (used by Super Admin).
   */
  createCompanyInCloud: async (data: {
    company_id: string;
    name: string;
    contact_email: string;
    contact_phone?: string;
    plan_type: string;
    max_users: number;
    validity_days: number;
  }): Promise<CloudCompany> => {
    const compId = data.company_id.trim().toUpperCase();
    const now = new Date();
    const expiry = new Date(now.getTime() + data.validity_days * 86400 * 1000);

    // Cryptographic-like key format: SNX-ABCD-1234-EF56
    const randomHex = () => Math.random().toString(36).substring(2, 6).toUpperCase();
    const licenseKey = `SNX-${randomHex()}-${randomHex()}-${randomHex()}`;

    const newCompany: CloudCompany = {
      company_id: compId,
      name: data.name.trim(),
      contact_email: data.contact_email.trim(),
      contact_phone: data.contact_phone || '',
      plan_type: data.plan_type || 'Enterprise',
      license_key: licenseKey,
      license_status: 'ACTIVE',
      license_start: now.toISOString(),
      license_expiry: expiry.toISOString(),
      max_users: Number(data.max_users) || 5,
      created_at: now.toISOString()
    };

    const compRef = doc(db, 'companies', compId);
    await setDoc(compRef, newCompany);
    return newCompany;
  },

  /**
   * Fetches all companies from Cloud Firestore for Super Admin.
   */
  fetchCloudCompanies: async (): Promise<CloudCompany[]> => {
    try {
      const q = collection(db, 'companies');
      const snapshot = await getDocs(q);
      const list: CloudCompany[] = [];
      snapshot.forEach((d) => list.push(d.data() as CloudCompany));
      return list;
    } catch (e) {
      console.error('Error fetching companies from cloud:', e);
      return [];
    }
  },

  /**
   * Checks company user quota before registering a new user under a company.
   */
  canAddUserToCompany: async (companyId: string): Promise<{ allowed: boolean; currentCount: number; maxUsers: number }> => {
    try {
      const compRef = doc(db, 'companies', companyId.trim().toUpperCase());
      const compSnap = await getDoc(compRef);
      if (!compSnap.exists()) return { allowed: false, currentCount: 0, maxUsers: 0 };
      const comp = compSnap.data() as CloudCompany;

      const usersQuery = query(collection(db, 'company_users'), where('company_id', '==', comp.company_id));
      const userSnap = await getDocs(usersQuery);
      const currentCount = userSnap.size;

      return {
        allowed: currentCount < comp.max_users,
        currentCount,
        maxUsers: comp.max_users
      };
    } catch (_) {
      return { allowed: false, currentCount: 0, maxUsers: 0 };
    }
  },

  /**
   * Registers a company user in Firebase Auth and links to Firestore company_users.
   */
  registerCompanyUser: async (email: string, password: string, companyId: string, name?: string) => {
    const quota = await cloudLicenseService.canAddUserToCompany(companyId);
    if (!quota.allowed) {
      throw new Error(`Company user quota exceeded (${quota.currentCount}/${quota.maxUsers} active users). Contact SentinelX Admin to upgrade.`);
    }

    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const userDocRef = doc(db, 'company_users', cred.user.uid);
    await setDoc(userDocRef, {
      uid: cred.user.uid,
      email: email.trim(),
      company_id: companyId.trim().toUpperCase(),
      name: name || email.split('@')[0],
      role: 'COMPANY_USER',
      created_at: new Date().toISOString()
    });

    return cred.user;
  }
};
