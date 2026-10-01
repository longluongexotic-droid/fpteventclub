import { supabase, isSupabaseConfigured } from './supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const list = $('[data-recruitment-list]');
const dialog = $('[data-application-dialog]');
const form = $('#application-form');
const departments = ['Nội dung', 'Hậu cần', 'Kỹ thuật', 'Truyền thông', 'Đối ngoại'];
const state = {
  user: null,
  profile: null,
  events: [],
  eventsLoaded: false,
  eventsError: false,
  applications: [],
  applicationsLoading: false,
  selectedEvent: null,
};
let accessRequestId = 0;
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});

function node(tag, className, value) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (value !== undefined) result.textContent = value;
  return result;
}

function showStatus(selector, message = '', kind = '') {
  const target = $(selector);
  if (!target) return;
  target.textContent = message;
  target.dataset.kind = kind;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}

function canApply() {
  const memberEmail = (state.profile?.email || '').toLowerCase().endsWith('@fpt.edu.vn');
  return Boolean(state.user && state.profile?.is_active &&
    (state.profile.role === 'admin' ||
      (state.profile.role === 'member' && memberEmail)));
}

function isClosed(event) {
  if (!event.is_recruiting) return true;
  if (!event.application_deadline) return false;
  const deadline = new Date(event.application_deadline).getTime();
  return !Number.isFinite(deadline) || deadline <= Date.now();
}

function applicationFor(eventId) {
  return state.applications.find((application) => application.event_id === eventId);
}

function loginUrl(eventId) {
  const target = new URL('./tuyen-ban-to-chuc.html', location.href);
  target.searchParams.set('event', eventId);
  const login = new URL('./dang-nhap.html', location.href);
  login.searchParams.set('next', target.pathname + target.search);
  return login.href;
}

function renderAccess() {
  const gate = $('[data-member-gate]');
  const welcome = $('[data-member-welcome]');
  const applicationsSection = $('[data-applications-section]');
  const allowed = canApply();
  gate.hidden = allowed;
  welcome.hidden = !allowed;
  applicationsSection.hidden = !allowed;

  const gateText = gate.querySelector('p');
  const gateLink = gate.querySelector('a');
  if (state.user && !allowed) {
    gateText.textContent = 'Tài khoản này chưa được cấp quyền thành viên FEV. Vui lòng liên hệ Ban Chủ nhiệm để được hỗ trợ.';
    gateLink.hidden = true;
  } else {
    gateText.textContent = 'Đăng nhập tài khoản thành viên để đăng ký Ban Tổ chức.';
    gateLink.hidden = false;
  }

  const name = state.user?.user_metadata?.full_name
    || state.user?.user_metadata?.name
    || state.user?.email?.split('@')[0]
    || '';
  $('[data-recruitment-member]').textContent = name;
  renderEvents();
}

function renderEvents() {
  list.replaceChildren();
  $('[data-recruitment-empty]').hidden = !state.eventsLoaded
    || state.eventsError || state.events.length !== 0;
  $('[data-recruitment-count]').textContent = state.events.length
    ? `${state.events.length} SỰ KIỆN` : '';

  for (const event of state.events) {
    const card = node('article', 'recruitment-card');
    card.dataset.eventId = event.id;
    card.tabIndex = -1;
    card.append(node('p', 'eyebrow', 'FEV / ĐANG TUYỂN'));
    card.append(node('h3', '', event.title));
    card.append(node('p', 'recruitment-card-description', event.description || ''));

    const roles = node('div', 'recruitment-roles');
    for (const role of event.recruitment_departments || []) {
      roles.append(node('span', '', role));
    }
    card.append(roles);
    if (event.application_deadline) {
      card.append(node('p', 'recruitment-deadline',
        `Hạn ứng tuyển: ${formatDate(event.application_deadline)}`));
    }

    const actions = node('div', 'recruitment-card-actions');
    const button = node('button', 'member-button');
    button.type = 'button';
    const submitted = applicationFor(event.id);
    if (submitted) {
      button.textContent = `ĐÃ NỘP ĐƠN · ${submitted.status}`;
      button.disabled = true;
    } else if (!state.user) {
      button.textContent = 'ĐĂNG NHẬP ĐỂ ỨNG TUYỂN ↗';
      button.addEventListener('click', () => location.assign(loginUrl(event.id)));
    } else if (!canApply()) {
      button.textContent = 'CHỈ DÀNH CHO THÀNH VIÊN FEV';
      button.disabled = true;
    } else {
      button.textContent = state.applicationsLoading ? 'ĐANG KIỂM TRA ĐƠN…' : 'NỘP ĐƠN ỨNG TUYỂN ↗';
      button.disabled = state.applicationsLoading;
      button.addEventListener('click', () => openApplication(event));
    }
    button.setAttribute('aria-label', `${button.textContent}: ${event.title}`);
    actions.append(button);
    card.append(actions);
    list.append(card);
  }
}

function renderApplications() {
  const container = $('[data-applications-list]');
  container.replaceChildren();
  $('[data-applications-empty]').hidden = state.applications.length !== 0;
  for (const application of state.applications) {
    const item = node('article', 'application-item');
    const title = Array.isArray(application.events)
      ? application.events[0]?.title : application.events?.title;
    item.append(node('h3', '', title || 'Sự kiện FEV'));
    item.append(node('span', 'application-status', application.status));
    const meta = node('p', 'application-item-meta',
      `${application.selected_department} · Gửi ngày ${formatDate(application.created_at)}`);
    item.append(meta);
    container.append(item);
  }
}

async function loadEvents() {
  showStatus('[data-recruitment-status]', 'Đang tải thông tin tuyển Ban Tổ chức…');
  const { data, error } = await supabase.from('events')
    .select('id,title,description,application_deadline,recruitment_departments,is_recruiting')
    .eq('is_published', true)
    .eq('is_recruiting', true)
    .order('application_deadline', { ascending: true });
  state.eventsLoaded = true;
  if (error) {
    state.eventsError = true;
    $('[data-recruitment-empty]').hidden = true;
    showStatus('[data-recruitment-status]',
      'Chưa tải được danh sách tuyển Ban Tổ chức. Vui lòng thử lại sau.', 'error');
    return;
  }
  state.eventsError = false;
  state.events = (data || []).filter((event) => !isClosed(event));
  showStatus('[data-recruitment-status]');
  renderEvents();

  const eventId = new URLSearchParams(location.search).get('event');
  const card = [...list.children].find((item) => item.dataset.eventId === eventId);
  card?.focus();
}

async function loadApplications() {
  if (!canApply()) return;
  const userId = state.user.id;
  state.applicationsLoading = true;
  renderEvents();
  showStatus('[data-applications-status]', 'Đang tải đơn ứng tuyển…');
  const { data, error } = await supabase.from('recruitment_applications')
    .select('id,event_id,selected_department,status,created_at,events(title)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (state.user?.id !== userId) return;
  state.applicationsLoading = false;
  if (error) {
    $('[data-applications-empty]').hidden = true;
    showStatus('[data-applications-status]',
      'Chưa tải được trạng thái ứng tuyển. Vui lòng tải lại trang.', 'error');
  } else {
    state.applications = data || [];
    showStatus('[data-applications-status]');
    renderApplications();
  }
  renderEvents();
}

async function loadAccess() {
  const requestId = ++accessRequestId;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authError ? null : authData?.user || null;
  let profile = null;
  if (user) {
    const { data, error } = await supabase.from('profiles')
      .select('email,role,is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (!error) profile = data;
  }
  if (requestId !== accessRequestId) return;
  state.user = user;
  state.profile = profile;
  state.applications = [];
  renderAccess();
  if (canApply()) await loadApplications();
}

function openApplication(event) {
  if (!canApply() || isClosed(event) || applicationFor(event.id)) return;
  state.selectedEvent = event;
  form.reset();
  form.hidden = false;
  $('[data-application-success]').hidden = true;
  $('[data-application-event-title]').textContent = event.title;
  $('[data-application-account]').textContent = state.user.email || '';
  $('#application-email').value = state.user.email || '';
  $('#application-full-name').value = state.user.user_metadata?.full_name
    || state.user.user_metadata?.name || '';
  const select = $('#application-department');
  select.replaceChildren(node('option', '', 'Chọn ban ứng tuyển'));
  select.firstChild.value = '';
  for (const department of event.recruitment_departments || []) {
    if (!departments.includes(department)) continue;
    const option = node('option', '', department);
    option.value = department;
    select.append(option);
  }
  showStatus('[data-application-status]');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  $('#application-full-name').focus();
}

function closeApplication() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  state.selectedEvent = null;
}

function applicationError(error) {
  if (error?.code === '23505') return 'Bạn đã nộp đơn cho sự kiện này. Trạng thái đơn có thể xem ở bên dưới.';
  if (error?.code === '42501' || error?.code === 'PGRST301') {
    return 'Tài khoản chưa có quyền nộp đơn hoặc phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  }
  if (error?.message?.includes('event_closed')) return 'Sự kiện đã ngừng nhận đơn. Vui lòng chọn sự kiện khác.';
  return 'Chưa gửi được đơn. Vui lòng kiểm tra thông tin và thử lại.';
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity() || !state.selectedEvent) return;
  if (!canApply()) {
    showStatus('[data-application-status]',
      'Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại để gửi đơn.', 'error');
    return;
  }
  if (isClosed(state.selectedEvent)) {
    showStatus('[data-application-status]', 'Sự kiện đã hết hạn ứng tuyển.', 'error');
    return;
  }

  const values = new FormData(form);
  const portfolio = String(values.get('cv_portfolio_url') || '').trim();
  if (portfolio) {
    try {
      const url = new URL(portfolio);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
        throw new Error('Invalid portfolio URL');
      }
    } catch {
      showStatus('[data-application-status]',
        'Link CV / Portfolio cần là địa chỉ HTTPS hợp lệ.', 'error');
      return;
    }
  }
  const submit = $('[data-application-submit]');
  submit.disabled = true;
  showStatus('[data-application-status]', 'Đang gửi đơn ứng tuyển…');
  const payload = {
    user_id: state.user.id,
    event_id: state.selectedEvent.id,
    full_name: String(values.get('full_name') || '').trim(),
    student_id: String(values.get('student_id') || '').trim().toUpperCase(),
    email: state.user.email,
    phone: String(values.get('phone') || '').trim(),
    selected_department: String(values.get('selected_department') || ''),
    cv_portfolio_url: portfolio || null,
  };
  if (!payload.full_name || !payload.student_id || !payload.phone || !payload.email) {
    showStatus('[data-application-status]',
      'Vui lòng điền đầy đủ thông tin trước khi gửi đơn.', 'error');
    submit.disabled = false;
    return;
  }
  if (!/^[A-Za-z0-9._-]{4,30}$/.test(payload.student_id)) {
    showStatus('[data-application-status]',
      'Mã số sinh viên chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch nối (4–30 ký tự).', 'error');
    submit.disabled = false;
    return;
  }
  if (!/^[+0-9 .()-]{9,24}$/.test(payload.phone)) {
    showStatus('[data-application-status]',
      'Số điện thoại cần dài 9–24 ký tự và chỉ gồm số hoặc ký tự điện thoại thông dụng.', 'error');
    submit.disabled = false;
    return;
  }
  try {
    const { error } = await supabase.from('recruitment_applications').insert(payload);
    if (error) throw error;
    form.hidden = true;
    $('[data-application-success]').hidden = false;
    showStatus('[data-application-status]');
    await loadApplications();
  } catch (error) {
    showStatus('[data-application-status]', applicationError(error), 'error');
  } finally {
    submit.disabled = false;
  }
});

$('[data-application-close]')?.addEventListener('click', closeApplication);
$('[data-application-done]')?.addEventListener('click', () => {
  closeApplication();
  $('[data-applications-section]').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) closeApplication();
});
dialog?.addEventListener('close', () => { state.selectedEvent = null; });

if (!supabase || !(typeof isSupabaseConfigured === 'function'
  ? isSupabaseConfigured() : isSupabaseConfigured)) {
  $('[data-recruitment-empty]').hidden = true;
  showStatus('[data-recruitment-status]',
    'Website chưa được cấu hình kết nối dữ liệu. Vui lòng quay lại sau.', 'error');
} else {
  Promise.all([loadEvents(), loadAccess()]).catch(() => {
    showStatus('[data-recruitment-status]',
      'Không thể kết nối dữ liệu lúc này. Vui lòng thử lại sau.', 'error');
  });
  supabase.auth.onAuthStateChange(() => {
    // Supabase client calls must run after the auth callback returns.
    setTimeout(() => { loadAccess().catch(() => renderAccess()); }, 0);
  });
}
