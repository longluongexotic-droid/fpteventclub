(() => {
  'use strict';

  const select = (query) => document.querySelector(query);
  const all = (query) => [...document.querySelectorAll(query)];
  const loginForm = select('#member-login-form');
  const recruitmentList = select('[data-recruitment-list]');
  const dialog = select('#application-dialog');
  const applicationForm = select('#application-form');
  const recruitmentUrl = new URL('./tuyen-ban-to-chuc.html', window.location.href);
  const state = { user: null, csrfToken: '', events: [], selectedEvent: null, sessionError: null, sessionChecking: true };
  const dateFormatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

  function status(element, message = '', kind = '') {
    if (!element) return;
    element.textContent = message;
    element.dataset.kind = kind;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function dateLabel(value) {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : dateFormatter.format(parsed);
  }

  function returnTarget() {
    const candidate = new URLSearchParams(window.location.search).get('next');
    if (!candidate) return recruitmentUrl.href;
    try {
      const target = new URL(candidate, window.location.href);
      // Only the local recruitment page is a supported post-login destination.
      if (target.origin === window.location.origin && target.pathname === recruitmentUrl.pathname && !target.username && !target.password) {
        return target.href;
      }
    } catch { /* Ignore invalid return URLs. */ }
    return recruitmentUrl.href;
  }

  function loginUrl(eventId) {
    const target = new URL(recruitmentUrl.href);
    if (eventId) target.searchParams.set('event', eventId);
    const login = new URL('./dang-nhap.html', window.location.href);
    login.searchParams.set('next', target.pathname + target.search);
    return login.href;
  }

  async function request(path, payload, method = 'GET') {
    const headers = { Accept: 'application/json' };
    const options = { method, headers };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    if (method !== 'GET' && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
    if (window.FEVMemberBackend && typeof window.FEVMemberBackend.request === 'function') {
      return window.FEVMemberBackend.request(path, options);
    }
    const base = String(window.FEV_MEMBER_API || '/api').replace(/\/$/, '');
    let response;
    try {
      response = await fetch(base + path, { ...options, credentials: 'include' });
    } catch {
      throw new Error('Chưa thể kết nối. Vui lòng kiểm tra mạng và thử lại.');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Dịch vụ thành viên tạm thời chưa sẵn sàng. Vui lòng thử lại sau.');
    }
    if (!response.ok) {
      const error = new Error(data.error || 'Có lỗi xảy ra. Vui lòng thử lại.');
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function syncSession() {
    const user = state.user;
    all('[data-member-login]').forEach((link) => { link.hidden = Boolean(user); });
    all('[data-member-account]').forEach((account) => {
      account.hidden = !user;
      if (!user) account.open = false;
    });
    all('[data-member-name]').forEach((name) => { name.textContent = user ? (user.displayName || user.email) : 'Tài khoản'; });
    all('[data-member-email]').forEach((email) => { email.textContent = user?.email || ''; });
    const gate = select('[data-member-gate]');
    const welcome = select('[data-member-welcome]');
    if (gate) gate.hidden = Boolean(user);
    if (welcome) welcome.hidden = !user;
    const memberName = select('[data-recruitment-member]');
    if (memberName) memberName.textContent = user ? (user.displayName || user.email) : '';
    const history = select('[data-applications-section]');
    if (history) history.hidden = !user;
    if (loginForm) {
      loginForm.hidden = Boolean(user);
      select('[data-login-current]').hidden = !user;
      select('[data-login-current-name]').textContent = user ? (user.displayName || user.email) : '';
      select('[data-login-continue]').href = returnTarget();
    }
  }

  async function loadSession() {
    try {
      const result = await request('/auth/me');
      state.user = result.user || null;
      state.csrfToken = result.csrfToken || '';
    } catch (error) {
      state.sessionError = error;
      if (loginForm) {
        status(select('#login-status'), error.message, 'error');
        if (error.code === 'BACKEND_NOT_CONFIGURED') {
          select('[data-login-submit]').disabled = true;
          select('[data-login-submit]').textContent = 'ĐANG CHUẨN BỊ';
        }
      }
    } finally {
      state.sessionChecking = false;
      if (loginForm && state.sessionError?.code !== 'BACKEND_NOT_CONFIGURED') {
        select('[data-login-submit]').disabled = false;
      }
      syncSession();
    }
  }

  all('[data-member-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const errorElement = button.parentElement.querySelector('[data-member-account-error]');
      status(errorElement);
      try {
        await request('/auth/logout', {}, 'POST');
        state.user = null;
        state.csrfToken = '';
        syncSession();
        if (dialog?.open) dialog.close();
        if (recruitmentList) renderEventsAfterSession();
        select('[data-applications-list]')?.replaceChildren();
      } catch (error) {
        status(errorElement, error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  });

  const passwordToggle = select('[data-password-toggle]');
  passwordToggle?.addEventListener('click', () => {
    const input = select('#member-password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    passwordToggle.textContent = show ? 'ẨN' : 'HIỆN';
    passwordToggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    passwordToggle.setAttribute('aria-pressed', String(show));
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.sessionChecking || state.sessionError?.code === 'BACKEND_NOT_CONFIGURED' || select('[data-login-submit]').disabled) return;
    if (!loginForm.reportValidity()) return;
    const submit = select('[data-login-submit]');
    const password = select('#member-password');
    submit.disabled = true;
    submit.textContent = 'ĐANG ĐĂNG NHẬP…';
    status(select('#login-status'));
    try {
      const result = await request('/auth/login', {
        email: select('#member-email').value.trim(),
        password: password.value,
      }, 'POST');
      state.user = result.user;
      state.csrfToken = result.csrfToken || '';
      password.value = '';
      status(select('#login-status'), 'Đăng nhập thành công. Đang chuyển trang…', 'success');
      window.location.assign(returnTarget());
    } catch (error) {
      status(select('#login-status'), error.message, 'error');
      if (error.code !== 'BACKEND_NOT_CONFIGURED') submit.disabled = false;
      submit.textContent = error.code === 'BACKEND_NOT_CONFIGURED' ? 'ĐANG CHUẨN BỊ' : 'ĐĂNG NHẬP ↗';
    }
  });

  function eventIsClosed(event) {
    const deadline = event.deadline ? new Date(event.deadline).getTime() : NaN;
    return Number.isFinite(deadline) && deadline < Date.now();
  }

  function renderEvents() {
    if (!recruitmentList) return;
    recruitmentList.replaceChildren();
    const events = state.events;
    select('[data-recruitment-empty]').hidden = events.length > 0;
    select('[data-recruitment-count]').textContent = events.length ? events.length + ' SỰ KIỆN' : '';
    events.forEach((event) => {
      const card = element('article', 'recruitment-card');
      const closed = eventIsClosed(event);
      card.append(element('p', 'eyebrow', closed ? 'ĐÃ ĐÓNG ĐĂNG KÝ' : 'FEV / ĐANG TUYỂN'));
      const heading = element('h3', '', event.title);
      card.append(heading, element('p', 'recruitment-card-description', event.description || ''));
      const roles = element('div', 'recruitment-roles');
      for (const role of event.roles || []) roles.append(element('span', '', role));
      card.append(roles);
      const deadline = dateLabel(event.deadline);
      if (deadline) card.append(element('p', 'recruitment-deadline', 'Hạn đăng ký: ' + deadline));
      const actions = element('div', 'recruitment-card-actions');
      const button = element('button', 'member-button', closed ? 'ĐÃ HẾT HẠN ĐĂNG KÝ' : (state.user ? 'ĐĂNG KÝ THAM GIA ↗' : 'ĐĂNG NHẬP ĐỂ ĐĂNG KÝ ↗'));
      button.type = 'button';
      button.disabled = closed;
      button.setAttribute('aria-label', (state.user ? 'Đăng ký Ban Tổ chức: ' : 'Đăng nhập để đăng ký: ') + event.title);
      button.addEventListener('click', () => {
        if (!state.user) window.location.assign(loginUrl(event.id));
        else openApplication(event);
      });
      actions.append(button);
      card.append(actions);
      recruitmentList.append(card);
    });
  }

  async function loadRecruitment() {
    try {
      const result = await request('/recruitment');
      state.events = Array.isArray(result.events) ? result.events : [];
      status(select('[data-recruitment-status]'));
      renderEvents();
    } catch (error) {
      status(select('[data-recruitment-status]'), error.message, 'error');
      select('[data-recruitment-empty]').hidden = true;
    }
  }

  async function loadApplications() {
    if (!state.user || !recruitmentList) return;
    const list = select('[data-applications-list]');
    const message = select('[data-applications-status]');
    status(message, 'Đang tải đơn đăng ký…');
    try {
      const result = await request('/applications');
      const applications = Array.isArray(result.applications) ? result.applications : [];
      list.replaceChildren();
      status(message, applications.length ? '' : 'Bạn chưa có đơn đăng ký. Hãy chọn một sự kiện đang mở tuyển để bắt đầu.');
      const statusNames = { pending: 'Đã gửi', submitted: 'Đã gửi', reviewing: 'Đang xem xét', accepted: 'Đã được chọn', approved: 'Đã được chọn', rejected: 'Chưa được chọn', withdrawn: 'Đã rút đơn' };
      for (const application of applications) {
        const row = element('article', 'application-item');
        const body = element('div');
        body.append(element('h3', '', application.eventTitle));
        const submittedDate = dateLabel(application.createdAt);
        body.append(element('p', 'application-item-meta', application.role + (submittedDate ? ' · Gửi ngày ' + submittedDate : '')));
        row.append(body, element('span', 'application-status', statusNames[application.status] || 'Đã gửi'));
        if (application.motivation) row.append(element('p', 'application-item-message', application.motivation));
        list.append(row);
      }
    } catch (error) {
      status(message, error.message, 'error');
      if (error.status === 401) {
        state.user = null;
        state.csrfToken = '';
        syncSession();
        renderEventsAfterSession();
      }
    }
  }

  function openApplication(event) {
    if (!state.user || eventIsClosed(event)) return;
    state.selectedEvent = event;
    applicationForm.reset();
    applicationForm.hidden = false;
    select('[data-application-success]').hidden = true;
    select('#application-title').textContent = event.title;
    select('[data-application-email]').textContent = state.user.email;
    const roleSelect = select('#application-role');
    roleSelect.replaceChildren();
    const placeholder = element('option', '', 'Chọn vị trí');
    placeholder.value = '';
    roleSelect.append(placeholder);
    for (const role of event.roles || []) {
      const option = element('option', '', role);
      option.value = role;
      roleSelect.append(option);
    }
    status(select('[data-application-status]'));
    select('[data-application-submit]').disabled = false;
    select('[data-application-submit]').textContent = 'GỬI ĐĂNG KÝ ↗';
    dialog.showModal();
    roleSelect.focus();
  }

  all('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));

  applicationForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.user) {
      window.location.assign(loginUrl(state.selectedEvent?.id));
      return;
    }
    if (!applicationForm.reportValidity() || !state.selectedEvent) return;
    const motivation = select('#application-motivation').value.trim();
    if (motivation.length < 20 || motivation.length > 2000) {
      status(select('[data-application-status]'), 'Lời nhắn cần có từ 20 đến 2.000 ký tự.', 'error');
      select('#application-motivation').focus();
      return;
    }
    const button = select('[data-application-submit]');
    button.disabled = true;
    button.textContent = 'ĐANG GỬI ĐĂNG KÝ…';
    status(select('[data-application-status]'));
    try {
      await request('/applications', {
        eventId: state.selectedEvent.id,
        role: select('#application-role').value,
        motivation,
      }, 'POST');
      applicationForm.hidden = true;
      select('[data-application-success]').hidden = false;
      select('[data-application-success] [data-dialog-close]').focus();
      await loadApplications();
    } catch (error) {
      status(select('[data-application-status]'), error.message, 'error');
      if (error.status === 401) {
        state.user = null;
        state.csrfToken = '';
        syncSession();
        button.textContent = 'ĐĂNG NHẬP LẠI ↗';
      } else button.textContent = 'GỬI ĐĂNG KÝ ↗';
      button.disabled = false;
    }
  });

  const sessionReady = loadSession();
  if (recruitmentList) {
    Promise.all([sessionReady, loadRecruitment()]).then(async () => {
      renderEventsAfterSession();
      await loadApplications();
      const eventId = new URLSearchParams(window.location.search).get('event');
      const event = state.events.find((item) => String(item.id) === eventId);
      if (event && state.user && !eventIsClosed(event)) openApplication(event);
    });
  }

  function renderEventsAfterSession() {
    // A failed request must remain an error state, not an empty event listing.
    if (select('[data-recruitment-status]')?.dataset.kind !== 'error') renderEvents();
  }
})();
