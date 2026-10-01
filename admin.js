import { supabase, isSupabaseConfigured } from './supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const eventList = $('[data-admin-events-list]');
const applicationList = $('[data-admin-applications-list]');
const eventDialog = $('[data-event-dialog]');
const eventForm = $('#admin-event-form');
const statuses = ['Đã nhận', 'Đang duyệt', 'Phỏng vấn', 'Trúng tuyển', 'Từ chối'];
const pageSize = 500;
const state = { user: null, profile: null, events: [], applications: [], editingId: null };
let authRequestId = 0;
let dialogRequestId = 0;
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function node(tag, className, value) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (value !== undefined) result.textContent = value;
  return result;
}

function showStatus(target, message = '', kind = '') {
  const element = typeof target === 'string' ? $(target) : target;
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function adminAllowed() {
  return Boolean(state.user && state.profile?.role === 'admin' && state.profile?.is_active);
}

function formattedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
}

function safeHttpsUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? url.href : '';
  } catch { return ''; }
}

function setAccess(message, showLogin = false) {
  $('[data-admin-dashboard]').hidden = !adminAllowed();
  $('[data-admin-access]').hidden = adminAllowed();
  $('[data-admin-access-message]').textContent = message;
  $('[data-admin-login]').hidden = !showLogin;
}

async function refreshAdmin() {
  const requestId = ++authRequestId;
  if (eventDialog.open) closeEventDialog();
  eventForm.reset();
  $('#admin-link-input').value = '';
  state.user = null;
  state.profile = null;
  state.events = [];
  state.applications = [];
  eventList.replaceChildren();
  applicationList.replaceChildren();
  $('[data-admin-dashboard]').hidden = true;
  $('[data-admin-access]').hidden = false;
  if (!isSupabaseConfigured || !supabase) {
    setAccess('Website chưa được cấu hình Supabase. Vui lòng liên hệ quản trị viên.');
    return;
  }
  setAccess('Đang kiểm tra quyền quản trị…');
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError && authError.name !== 'AuthSessionMissingError') {
    if (requestId === authRequestId) {
      setAccess('Không kiểm tra được phiên đăng nhập. Vui lòng tải lại trang.');
    }
    return;
  }
  const user = authError ? null : authData?.user || null;
  let profile = null;
  let profileError = null;
  if (user) {
    const result = await supabase.from('profiles')
      .select('id,role,is_active').eq('id', user.id).maybeSingle();
    profileError = result.error;
    if (!profileError) profile = result.data;
  }
  if (requestId !== authRequestId) return;
  state.user = user;
  state.profile = profile;
  if (profileError) {
    setAccess('Không đọc được hồ sơ quản trị. Vui lòng kiểm tra kết nối và thử lại.');
    return;
  }
  if (!adminAllowed()) {
    state.events = [];
    state.applications = [];
    setAccess(user
      ? 'Tài khoản này chưa được cấp quyền quản trị FEV.'
      : 'Đăng nhập bằng tài khoản quản trị để truy cập trang này.', !user);
    return;
  }
  setAccess('');
  await Promise.all([loadEvents(), loadApplications()]);
}

async function fetchAllPages(createQuery) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    if (!adminAllowed()) return { data: null, cancelled: true };
    const { data, error } = await createQuery(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

function eventTags(event) {
  const tags = node('div', 'admin-tags');
  tags.append(node('span', `admin-tag${event.is_published ? ' is-live' : ''}`,
    event.is_published ? 'CÔNG KHAI' : 'BẢN NHÁP'));
  if (event.is_recruiting) {
    tags.append(node('span', 'admin-tag is-open',
      new Date(event.application_deadline).getTime() > Date.now()
        ? 'ĐANG TUYỂN' : 'HẾT HẠN TUYỂN'));
  }
  return tags;
}

function renderEvents() {
  const term = $('#admin-event-search').value.trim().toLocaleLowerCase('vi');
  const year = $('#admin-event-year').value;
  const visible = state.events.filter((event) =>
    (!term || event.title.toLocaleLowerCase('vi').includes(term))
    && (!year || String(event.year) === year));
  eventList.replaceChildren();
  const empty = $('[data-admin-events-empty]');
  empty.hidden = visible.length !== 0;
  empty.textContent = state.events.length
    ? 'Không tìm thấy sự kiện phù hợp.' : 'Chưa có sự kiện nào.';
  $('[data-admin-events-count]').textContent = `${state.events.length} sự kiện trong cơ sở dữ liệu`;

  for (const event of visible) {
    const card = node('article', 'admin-event-card');
    const head = node('div', 'admin-event-head');
    const info = node('div');
    info.append(node('h3', '', event.title));
    const meta = [String(event.year), event.category || 'Chưa phân loại'];
    if (event.display_order) meta.push(`Thứ tự ${event.display_order}`);
    if (event.is_recruiting && event.application_deadline) {
      meta.push(`Hạn nộp ${formattedDate(event.application_deadline)}`);
    }
    info.append(node('p', 'admin-card-meta', meta.join(' · ')));
    head.append(info, eventTags(event));
    card.append(head);
    if (event.description) {
      const summary = event.description.length > 280
        ? `${event.description.slice(0, 280)}…` : event.description;
      card.append(node('p', 'admin-card-description', summary));
    }
    const actions = node('div', 'admin-card-actions');
    const edit = node('button', '', 'SỬA SỰ KIỆN');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Sửa sự kiện ${event.title}`);
    edit.addEventListener('click', () => openEditEvent(event));
    const remove = node('button', 'admin-danger', 'XÓA');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Xóa sự kiện ${event.title}`);
    remove.addEventListener('click', () => deleteEvent(event, remove));
    actions.append(edit, remove);
    card.append(actions);
    eventList.append(card);
  }
}

function syncYearFilter() {
  const select = $('#admin-event-year');
  const current = select.value;
  select.replaceChildren(node('option', '', 'Tất cả'));
  select.firstChild.value = '';
  const years = [...new Set(state.events.map((event) => event.year))]
    .sort((a, b) => b - a);
  for (const year of years) {
    const option = node('option', '', String(year));
    option.value = String(year);
    select.append(option);
  }
  select.value = years.includes(Number(current)) ? current : '';
}

async function loadEvents() {
  showStatus('[data-admin-events-status]', 'Đang tải sự kiện…');
  const { data, error, cancelled } = await fetchAllPages((from, to) => supabase.from('events')
    .select('id,title,year,category,display_order,description,cover_image,is_published,is_recruiting,application_deadline,recruitment_departments,created_at')
    .order('year', { ascending: false })
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to));
  if (cancelled) return;
  if (!adminAllowed()) return;
  if (error) {
    showStatus('[data-admin-events-status]',
      'Chưa tải được sự kiện. Vui lòng thử lại.', 'error');
    return;
  }
  state.events = data || [];
  syncYearFilter();
  renderEvents();
  showStatus('[data-admin-events-status]');
}

function eventName(application) {
  return Array.isArray(application.events)
    ? application.events[0]?.title : application.events?.title;
}

function renderApplications() {
  const term = $('#admin-application-search').value.trim().toLocaleLowerCase('vi');
  const statusFilter = $('#admin-application-status-filter').value;
  const visible = state.applications.filter((application) => {
    const haystack = [application.full_name, application.student_id,
      eventName(application), application.email].join(' ').toLocaleLowerCase('vi');
    return (!term || haystack.includes(term))
      && (!statusFilter || application.status === statusFilter);
  });
  applicationList.replaceChildren();
  const empty = $('[data-admin-applications-empty]');
  empty.hidden = visible.length !== 0;
  empty.textContent = state.applications.length
    ? 'Không tìm thấy đơn ứng tuyển phù hợp.' : 'Chưa có đơn ứng tuyển nào.';
  $('[data-admin-applications-count]').textContent = `${state.applications.length} đơn ứng tuyển`;

  for (const application of visible) {
    const card = node('article', 'admin-application-card');
    const head = node('div', 'admin-application-head');
    const info = node('div');
    info.append(node('h3', '', application.full_name));
    info.append(node('p', 'admin-card-meta',
      `${application.student_id} · ${application.selected_department} · ${eventName(application) || 'Sự kiện FEV'} · ${formattedDate(application.created_at)}`));
    head.append(info, node('span', 'admin-tag is-live', application.status));
    card.append(head);

    const contacts = node('div', 'admin-application-contact');
    contacts.append(node('span', '', application.email),
      node('span', '', application.phone));
    const portfolio = safeHttpsUrl(application.cv_portfolio_url);
    if (portfolio) {
      const link = node('a', '', 'XEM CV / PORTFOLIO ↗');
      link.href = portfolio;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      contacts.append(link);
    }
    card.append(contacts);

    const row = node('div', 'admin-status-row');
    const label = node('label', '', 'Cập nhật trạng thái');
    const select = node('select');
    select.setAttribute('aria-label', `Trạng thái đơn của ${application.full_name}`);
    for (const status of statuses) {
      const option = node('option', '', status);
      option.value = status;
      select.append(option);
    }
    select.value = application.status;
    label.append(select);
    const save = node('button', '', 'LƯU TRẠNG THÁI');
    save.type = 'button';
    save.disabled = true;
    select.addEventListener('change', () => {
      save.disabled = select.value === application.status;
    });
    const remove = node('button', 'admin-danger', 'XÓA ĐƠN');
    remove.type = 'button';
    const feedback = node('p', 'member-form-status admin-item-status');
    feedback.setAttribute('role', 'status');
    row.append(label, save, remove, feedback);
    save.addEventListener('click', () => updateApplication(application, select, save, feedback));
    remove.addEventListener('click', () => deleteApplication(application, remove, feedback));
    card.append(row);
    applicationList.append(card);
  }
}

async function loadApplications() {
  showStatus('[data-admin-applications-status]', 'Đang tải đơn ứng tuyển…');
  const { data, error, cancelled } = await fetchAllPages((from, to) => supabase.from('recruitment_applications')
    .select('id,user_id,event_id,full_name,student_id,email,phone,selected_department,cv_portfolio_url,status,created_at,updated_at,events(title)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to));
  if (cancelled) return;
  if (!adminAllowed()) return;
  if (error) {
    showStatus('[data-admin-applications-status]',
      'Chưa tải được đơn ứng tuyển. Vui lòng thử lại.', 'error');
    return;
  }
  state.applications = data || [];
  renderApplications();
  showStatus('[data-admin-applications-status]');
}

async function updateApplication(application, select, button, feedback) {
  if (!adminAllowed() || !statuses.includes(select.value)) return;
  button.disabled = true;
  showStatus(feedback, 'Đang lưu trạng thái…');
  const { data, error } = await supabase.from('recruitment_applications')
    .update({ status: select.value }).eq('id', application.id)
    .select('id,status').maybeSingle();
  if (error || !data) {
    showStatus(feedback, 'Không lưu được trạng thái. Vui lòng thử lại.', 'error');
    button.disabled = false;
    return;
  }
  application.status = data.status;
  showStatus(feedback, 'Đã cập nhật trạng thái.', 'success');
  // Refresh the status badge and any active status filter.
  setTimeout(renderApplications, 500);
}

async function deleteApplication(application, button, feedback) {
  if (!adminAllowed()) return;
  if (!confirm(`Xóa đơn ứng tuyển của ${application.full_name}? Hành động này không thể hoàn tác.`)) return;
  button.disabled = true;
  showStatus(feedback, 'Đang xóa đơn…');
  const { data, error } = await supabase.from('recruitment_applications')
    .delete().eq('id', application.id).select('id').maybeSingle();
  if (error || !data) {
    showStatus(feedback, 'Không xóa được đơn. Vui lòng thử lại.', 'error');
    button.disabled = false;
    return;
  }
  state.applications = state.applications.filter((item) => item.id !== application.id);
  renderApplications();
  showStatus('[data-admin-applications-status]', 'Đã xóa đơn ứng tuyển.', 'success');
}

function syncRecruitmentFields() {
  const active = $('#admin-recruiting-input').checked;
  $('[data-recruitment-fields]').hidden = !active;
  $('#admin-deadline-input').required = active;
}

function showEventDialog() {
  if (typeof eventDialog.showModal === 'function') eventDialog.showModal();
  else eventDialog.setAttribute('open', '');
  $('#admin-title-input').focus();
}

function closeEventDialog() {
  ++dialogRequestId;
  if (typeof eventDialog.close === 'function') eventDialog.close();
  else eventDialog.removeAttribute('open');
  state.editingId = null;
}

function openNewEvent() {
  if (!adminAllowed()) return;
  ++dialogRequestId;
  state.editingId = null;
  eventForm.reset();
  $('[data-event-dialog-title]').textContent = 'Thêm sự kiện';
  $('#admin-year-input').value = new Date().getFullYear();
  $('#admin-published-input').checked = true;
  $('#admin-link-input').disabled = false;
  $('[data-event-save]').disabled = false;
  showStatus('[data-event-form-status]');
  showStatus('[data-event-link-status]');
  syncRecruitmentFields();
  showEventDialog();
}

async function openEditEvent(event) {
  if (!adminAllowed()) return;
  const requestId = ++dialogRequestId;
  state.editingId = event.id;
  eventForm.reset();
  $('[data-event-dialog-title]').textContent = 'Sửa sự kiện';
  $('#admin-title-input').value = event.title;
  $('#admin-year-input').value = event.year;
  $('#admin-category-input').value = event.category || '';
  $('#admin-order-input').value = event.display_order || '';
  $('#admin-description-input').value = event.description || '';
  $('#admin-cover-input').value = event.cover_image || '';
  $('#admin-published-input').checked = event.is_published;
  $('#admin-recruiting-input').checked = event.is_recruiting;
  $('#admin-deadline-input').value = localDateTime(event.application_deadline);
  for (const checkbox of eventForm.querySelectorAll('[name="department"]')) {
    checkbox.checked = (event.recruitment_departments || []).includes(checkbox.value);
  }
  syncRecruitmentFields();
  $('#admin-link-input').value = '';
  $('#admin-link-input').disabled = true;
  $('[data-event-save]').disabled = true;
  showStatus('[data-event-form-status]');
  showStatus('[data-event-link-status]', 'Đang tải link đăng ký được bảo vệ…');
  showEventDialog();
  const { data, error } = await supabase.rpc('fev_event_registration_link',
    { p_event_id: event.id });
  if (requestId !== dialogRequestId || state.editingId !== event.id) return;
  if (error) {
    showStatus('[data-event-link-status]',
      'Không đọc được link đăng ký. Đóng form rồi thử lại.', 'error');
    return;
  }
  $('#admin-link-input').value = data || '';
  $('#admin-link-input').disabled = false;
  $('[data-event-save]').disabled = false;
  showStatus('[data-event-link-status]');
}

function eventPayload() {
  const values = new FormData(eventForm);
  const title = String(values.get('title') || '').trim();
  const year = Number(values.get('year'));
  const displayOrder = String(values.get('display_order') || '').trim();
  const recruiting = $('#admin-recruiting-input').checked;
  const published = $('#admin-published-input').checked;
  const deadlineInput = String(values.get('application_deadline') || '');
  const departments = values.getAll('department').map(String);
  const link = String(values.get('registration_link') || '').trim();
  const coverImage = String(values.get('cover_image') || '').trim();
  if (!title || title.length > 180 || !Number.isInteger(year)
      || year < 2000 || year > 2100) throw new Error('Kiểm tra tên và năm sự kiện.');
  if (displayOrder && (!Number.isInteger(Number(displayOrder)) || Number(displayOrder) < 1)) {
    throw new Error('Thứ tự hiển thị cần là số nguyên dương.');
  }
  if (link && (/[\s]/.test(link) || !safeHttpsUrl(link))) {
    throw new Error('Link đăng ký cần là URL HTTPS hợp lệ.');
  }
  if (coverImage && !safeHttpsUrl(coverImage)
      && !coverImage.startsWith('./') && !coverImage.startsWith('/')) {
    throw new Error('Ảnh bìa cần là URL HTTPS hoặc đường dẫn ảnh trong website.');
  }
  if (recruiting && (!published || !deadlineInput || departments.length === 0)) {
    throw new Error('Để mở tuyển, hãy công khai sự kiện, đặt hạn nhận đơn và chọn ít nhất một ban.');
  }
  const deadline = deadlineInput ? new Date(deadlineInput) : null;
  if (deadline && Number.isNaN(deadline.getTime())) throw new Error('Hạn nhận đơn không hợp lệ.');
  if (recruiting && deadline <= new Date()) throw new Error('Hạn nhận đơn phải nằm trong tương lai.');
  return {
    title,
    year,
    category: String(values.get('category') || '') || null,
    display_order: displayOrder ? Number(displayOrder) : null,
    description: String(values.get('description') || '').trim(),
    cover_image: coverImage || null,
    registration_link: link || null,
    is_published: published,
    is_recruiting: recruiting,
    application_deadline: deadline ? deadline.toISOString() : null,
    recruitment_departments: departments,
  };
}

eventForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const save = $('[data-event-save]');
  if (!adminAllowed() || save.disabled || !eventForm.reportValidity()) return;
  let payload;
  try { payload = eventPayload(); }
  catch (error) { showStatus('[data-event-form-status]', error.message, 'error'); return; }
  save.disabled = true;
  showStatus('[data-event-form-status]', 'Đang lưu sự kiện…');
  const query = state.editingId
    ? supabase.from('events').update(payload).eq('id', state.editingId)
    : supabase.from('events').insert(payload);
  const { data, error } = await query.select('id').maybeSingle();
  if (error || !data) {
    showStatus('[data-event-form-status]',
      'Không lưu được sự kiện. Vui lòng kiểm tra thông tin và quyền quản trị.', 'error');
    save.disabled = false;
    return;
  }
  closeEventDialog();
  await loadEvents();
  showStatus('[data-admin-events-status]', 'Đã lưu sự kiện.', 'success');
});

async function deleteEvent(event, button) {
  if (!adminAllowed()) return;
  if (!confirm(`Xóa sự kiện “${event.title}”? Hành động này không thể hoàn tác.`)) return;
  button.disabled = true;
  showStatus('[data-admin-events-status]', 'Đang xóa sự kiện…');
  const { data, error } = await supabase.from('events')
    .delete().eq('id', event.id).select('id').maybeSingle();
  if (error || !data) {
    const message = error?.code === '23503'
      ? 'Sự kiện đã có đơn ứng tuyển. Hãy đóng tuyển hoặc xử lý đơn trước khi xóa.'
      : 'Không xóa được sự kiện. Vui lòng thử lại.';
    showStatus('[data-admin-events-status]', message, 'error');
    button.disabled = false;
    return;
  }
  state.events = state.events.filter((item) => item.id !== event.id);
  syncYearFilter();
  renderEvents();
  showStatus('[data-admin-events-status]', 'Đã xóa sự kiện.', 'success');
}

$('[data-event-new]')?.addEventListener('click', openNewEvent);
$('[data-event-close]')?.addEventListener('click', closeEventDialog);
$('[data-event-cancel]')?.addEventListener('click', closeEventDialog);
$('#admin-recruiting-input')?.addEventListener('change', syncRecruitmentFields);
$('#admin-event-search')?.addEventListener('input', renderEvents);
$('#admin-event-year')?.addEventListener('change', renderEvents);
$('#admin-application-search')?.addEventListener('input', renderApplications);
$('#admin-application-status-filter')?.addEventListener('change', renderApplications);
eventDialog?.addEventListener('click', (event) => {
  if (event.target === eventDialog) closeEventDialog();
});
eventDialog?.addEventListener('close', () => {
  ++dialogRequestId;
  state.editingId = null;
});

if (supabase) supabase.auth.onAuthStateChange((event, session) => {
  if (event !== 'SIGNED_OUT' && event !== 'USER_UPDATED'
      && !(event === 'SIGNED_IN' && session?.user?.id !== state.user?.id)) return;
  setTimeout(() => { refreshAdmin().catch(() =>
    setAccess('Không kiểm tra được quyền quản trị. Vui lòng tải lại trang.')); }, 0);
});
refreshAdmin().catch(() =>
  setAccess('Không thể kết nối cơ sở dữ liệu. Vui lòng thử lại sau.'));
