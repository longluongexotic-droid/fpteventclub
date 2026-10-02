import { supabase, isSupabaseConfigured } from './supabase-client.js';

const select = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const loginForm = select('#member-login-form');
const loginStatus = select('#login-status');
const googleButton = select('[data-google-login]');
const submitButton = select('[data-login-submit]');
const allowedDestinations = [
  new URL('./', import.meta.url).pathname,
  new URL('./su-kien.html', import.meta.url).pathname,
  new URL('./tuyen-ban-to-chuc.html', import.meta.url).pathname,
  new URL('./quan-tri.html', import.meta.url).pathname,
];
let currentUser = null;
let currentProfile = null;
let oauthNext = null;
let oauthCallbackPending = Boolean(loginForm && new URLSearchParams(location.search).has('code'));
let passwordLoginPending = false;

function showStatus(message = '', kind = '') {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.dataset.kind = kind;
}

function returnTarget(forAdmin = false) {
  const candidate = new URLSearchParams(location.search).get('next') || oauthNext;
  const fallback = new URL(forAdmin ? './quan-tri.html' : './tuyen-ban-to-chuc.html', import.meta.url);
  if (!candidate) return fallback;
  try {
    const target = new URL(candidate, location.href);
    if (target.origin === location.origin && allowedDestinations.includes(target.pathname) &&
        !target.username && !target.password) return target;
  } catch { /* Ignore invalid and external next URLs. */ }
  return fallback;
}

function avatarUrl(user, profile) {
  try {
    const url = new URL(profile?.avatar_url || user?.user_metadata?.avatar_url || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function displayName(user, profile) {
  return profile?.full_name || user?.user_metadata?.full_name ||
    user?.user_metadata?.name || user?.email?.split('@')[0] || 'Tài khoản';
}

function syncHeader() {
  const loggedIn = Boolean(currentUser);
  all('[data-member-login]').forEach((link) => { link.hidden = loggedIn; });
  all('[data-member-account]').forEach((account) => {
    account.hidden = !loggedIn;
    if (!loggedIn) account.open = false;
    const summary = account.querySelector('summary');
    summary?.querySelector('.member-avatar')?.remove();
    const icon = summary?.querySelector('.member-icon');
    const src = avatarUrl(currentUser, currentProfile);
    if (src && summary) {
      const image = document.createElement('img');
      image.className = 'member-avatar';
      image.src = src;
      image.alt = '';
      image.width = 24;
      image.height = 24;
      image.referrerPolicy = 'no-referrer';
      summary.insertBefore(image, icon || summary.firstChild);
    }
    if (icon) icon.hidden = Boolean(src);
  });
  all('[data-member-name]').forEach((name) => {
    name.textContent = loggedIn ? displayName(currentUser, currentProfile) : 'Tài khoản';
  });
  all('[data-member-email]').forEach((email) => { email.textContent = currentUser?.email || ''; });
  all('.member-account-panel').forEach((panel) => {
    if (panel.querySelector('[data-member-admin]')) return;
    const link = document.createElement('a');
    link.href = new URL('./quan-tri.html', import.meta.url).href;
    link.textContent = 'Trang quản trị ↗';
    link.dataset.memberAdmin = '';
    link.hidden = true;
    panel.insertBefore(link, panel.querySelector('[data-member-logout]'));
  });
  all('[data-member-admin]').forEach((link) => {
    link.hidden = currentProfile?.role !== 'admin' || !currentProfile?.is_active;
  });
  const currentNotice = select('[data-login-current]');
  if (currentNotice) {
    currentNotice.hidden = !loggedIn;
    select('[data-login-current-name]').textContent = loggedIn ? displayName(currentUser, currentProfile) : '';
    select('[data-login-continue]').href = returnTarget(currentProfile?.role === 'admin').href;
  }
  if (loginForm) loginForm.hidden = loggedIn;
  if (googleButton) googleButton.hidden = loggedIn;
  if (loginForm && loggedIn && (!currentProfile?.is_active || currentProfile?.role === 'guest')) {
    showStatus('Tài khoản đã xác thực nhưng chưa được CLB cấp quyền thành viên. Vui lòng liên hệ Ban Chủ nhiệm.', 'error');
  }
  document.dispatchEvent(new CustomEvent('fev:authchange', {
    detail: { user: currentUser, profile: currentProfile },
  }));
}

async function refreshAuth() {
  if (!isSupabaseConfigured) {
    currentUser = null;
    currentProfile = null;
    syncHeader();
    showStatus('Chưa cấu hình Supabase URL và anon key cho website.', 'error');
    return;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') {
    showStatus('Không kiểm tra được phiên đăng nhập. Vui lòng thử lại.', 'error');
    return false;
  }
  currentUser = data?.user || null;
  currentProfile = null;
  if (currentUser) {
    const result = await supabase.from('profiles')
      .select('id,full_name,email,avatar_url,role,is_active')
      .eq('id', currentUser.id).maybeSingle();
    if (result.error) {
      showStatus('Không tải được quyền tài khoản. Vui lòng tải lại trang.', 'error');
      return false;
    }
    currentProfile = result.data;
    const isFpt = (currentUser.email || '').toLowerCase().endsWith('@fpt.edu.vn');
    if (!isFpt && currentProfile?.role !== 'admin') {
      await supabase.auth.signOut();
      currentUser = null;
      currentProfile = null;
      showStatus(passwordLoginPending
        ? 'Form email và mật khẩu chỉ dành cho tài khoản quản trị được CLB cấp quyền.'
        : 'Chỉ tài khoản Google @fpt.edu.vn được phép đăng nhập.', 'error');
    }
  }
  syncHeader();
  return true;
}

async function handleOAuthCallback() {
  if (!loginForm || !isSupabaseConfigured) return false;
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    try {
      oauthNext = sessionStorage.getItem('fev-oauth-next');
      sessionStorage.removeItem('fev-oauth-next');
    } catch { oauthNext = null; }
  }
  if (params.has('error')) {
    showStatus('Đăng nhập Google chưa hoàn tất. Vui lòng thử lại.', 'error');
    for (const key of ['error', 'error_description', 'error_code']) params.delete(key);
    history.replaceState(null, '', `${location.pathname}${params.size ? '?' + params : ''}`);
    return false;
  }
  const code = params.get('code');
  if (!code) return false;
  showStatus('Đang xác thực tài khoản Google…');
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  params.delete('code');
  history.replaceState(null, '', `${location.pathname}${params.size ? '?' + params : ''}`);
  if (error) {
    showStatus('Không hoàn tất được đăng nhập Google. Vui lòng thử lại.', 'error');
    return false;
  }
  const { data: authenticated } = await supabase.auth.getUser();
  if (!(authenticated?.user?.email || '').toLowerCase().endsWith('@fpt.edu.vn')) {
    await supabase.auth.signOut();
    showStatus('Chỉ email sinh viên @fpt.edu.vn được đăng nhập bằng Google.', 'error');
    return false;
  }
  const profileLoaded = await refreshAuth();
  if (!profileLoaded) return false;
  if (currentProfile?.is_active && ['member', 'admin'].includes(currentProfile.role)) {
    location.assign(returnTarget().href);
    return true;
  }
  showStatus('Tài khoản đã xác thực nhưng chưa được CLB cấp quyền thành viên. Vui lòng liên hệ Ban Chủ nhiệm.', 'error');
  return false;
}

all('[data-member-logout]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!supabase) return;
    button.disabled = true;
    const errorNode = button.parentElement.querySelector('[data-member-account-error]');
    if (errorNode) errorNode.textContent = '';
    const { error } = await supabase.auth.signOut();
    button.disabled = false;
    if (error) {
      if (errorNode) errorNode.textContent = 'Không đăng xuất được. Vui lòng thử lại.';
      return;
    }
    try { sessionStorage.removeItem('fev-oauth-next'); } catch { /* Ignore blocked storage. */ }
    currentUser = null;
    currentProfile = null;
    syncHeader();
  });
});

select('[data-password-toggle]')?.addEventListener('click', (event) => {
  const input = select('#member-password');
  const shown = input.type === 'password';
  input.type = shown ? 'text' : 'password';
  event.currentTarget.textContent = shown ? 'ẨN' : 'HIỆN';
  event.currentTarget.setAttribute('aria-pressed', String(shown));
  event.currentTarget.setAttribute('aria-label', shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
});

googleButton?.addEventListener('click', async () => {
  if (!supabase) { showStatus('Chưa cấu hình Supabase.', 'error'); return; }
  googleButton.disabled = true;
  showStatus('Đang chuyển đến Google…');
  const redirect = new URL('./dang-nhap.html', import.meta.url);
  try {
    sessionStorage.setItem('fev-oauth-next', returnTarget().pathname + returnTarget().search);
  } catch { /* The default destination remains available. */ }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirect.href,
      queryParams: { hd: 'fpt.edu.vn', prompt: 'select_account' },
    },
  });
  if (error) {
    showStatus('Không bắt đầu được đăng nhập Google. Vui lòng thử lại.', 'error');
    googleButton.disabled = false;
  }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase || !loginForm.reportValidity()) return;
  submitButton.disabled = true;
  passwordLoginPending = true;
  showStatus('Đang xác thực tài khoản quản trị…');
  try {
    const email = select('#member-email').value.trim();
    const password = select('#member-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    select('#member-password').value = '';
    if (error) {
      showStatus('Email hoặc mật khẩu không đúng.', 'error');
      submitButton.disabled = false;
      return;
    }
    const profileLoaded = await refreshAuth();
    if (!profileLoaded) {
      submitButton.disabled = false;
      return;
    }
    if (currentProfile?.role !== 'admin' || !currentProfile?.is_active) {
      await supabase.auth.signOut();
      currentUser = null;
      currentProfile = null;
      syncHeader();
      showStatus('Form email và mật khẩu chỉ dành cho tài khoản quản trị được CLB cấp quyền.', 'error');
      submitButton.disabled = false;
      return;
    }
    location.assign(returnTarget(true).href);
  } finally {
    passwordLoginPending = false;
  }
});

if (supabase) supabase.auth.onAuthStateChange(() => {
  if (!oauthCallbackPending) setTimeout(refreshAuth, 0);
});
if (submitButton) submitButton.disabled = !isSupabaseConfigured;
await handleOAuthCallback();
oauthCallbackPending = false;
await refreshAuth();
