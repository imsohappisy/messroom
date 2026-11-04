/**
 * Profile & Account Manager for Messroom
 * Pure code & solid colors. No AI images or external avatar assets.
 */

const STORAGE_KEY_PROFILES = 'messroom_accounts';
const STORAGE_KEY_ACTIVE_ID = 'messroom_active_account_id';

const SOLID_COLORS = [
  '#2563eb', // Blue
  '#16a34a', // Green
  '#dc2626', // Red
  '#d97706', // Amber
  '#4f46e5', // Indigo
  '#52525b'  // Zinc
];

export class AccountManager {
  constructor() {
    this.accounts = [];
    this.activeAccount = null;
    this.listeners = [];
    this.load();
  }

  load() {
    try {
      const rawAccounts = localStorage.getItem(STORAGE_KEY_PROFILES);
      if (rawAccounts) {
        this.accounts = JSON.parse(rawAccounts);
      }
    } catch (e) {
      console.error('Failed to load accounts from storage', e);
      this.accounts = [];
    }

    if (!this.accounts || this.accounts.length === 0) {
      const defaultAccount = this.createDefaultAccount('사용자');
      this.accounts = [defaultAccount];
      this.activeAccount = defaultAccount;
      this.save();
    } else {
      const activeId = localStorage.getItem(STORAGE_KEY_ACTIVE_ID);
      this.activeAccount = this.accounts.find(a => a.id === activeId) || this.accounts[0];
    }
  }

  createDefaultAccount(suggestedName) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const name = suggestedName || `사용자-${randomSuffix}`;
    return {
      id: 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
      name: name,
      bio: '온라인 (P2P 통신 대기)',
      color: SOLID_COLORS[0],
      theme: 'monochrome',
      soundEnabled: true,
      createdAt: Date.now()
    };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(this.accounts));
      if (this.activeAccount) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_ID, this.activeAccount.id);
      }
    } catch (e) {
      console.error('Failed to save accounts', e);
    }
    this.notify();
  }

  getActive() {
    return this.activeAccount;
  }

  getSolidColors() {
    return SOLID_COLORS;
  }

  updateActiveProfile(updates) {
    if (!this.activeAccount) return;
    Object.assign(this.activeAccount, updates);
    this.save();
    return this.activeAccount;
  }

  createAccount(name) {
    const newAcc = this.createDefaultAccount(name);
    this.accounts.push(newAcc);
    this.activeAccount = newAcc;
    this.save();
    return newAcc;
  }

  switchAccount(id) {
    const target = this.accounts.find(a => a.id === id);
    if (target) {
      this.activeAccount = target;
      this.save();
      return target;
    }
    return null;
  }

  deleteAccount(id) {
    if (this.accounts.length <= 1) {
      return false;
    }
    this.accounts = this.accounts.filter(a => a.id !== id);
    if (this.activeAccount.id === id) {
      this.activeAccount = this.accounts[0];
    }
    this.save();
    return true;
  }

  getPublicProfile() {
    if (!this.activeAccount) return null;
    return {
      id: this.activeAccount.id,
      name: this.activeAccount.name,
      bio: this.activeAccount.bio,
      color: this.activeAccount.color,
      theme: this.activeAccount.theme
    };
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify() {
    this.listeners.forEach(cb => {
      try { cb(this.activeAccount); } catch (e) { console.error(e); }
    });
  }
}

export const accountManager = new AccountManager();
