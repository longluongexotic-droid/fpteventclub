(() => {
  'use strict';

  const select = (query) => document.querySelector(query);
  const all = (query) => [...document.querySelectorAll(query)];
  const loginForm = select('#member-login-form');
  const recruitmentList = select('[data-recruitment-list]');
  const recruitmentUrl = new URL('./tuyen-ban-to-chuc.html', window.location.href);
  const state = { user: null, events: [], sessionChecking: true };
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
    if (window.FEVMemberBackend && typeof window.FEVMemberBackend.request === 'function') {
      return window.FEVMemberBackend.request(path, options);
    }
    throw new Error('Chưa tải được chức năng đăng nhập. Vui lòng tải lại trang.');
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
    } catch (error) {
      if (loginForm) {
        status(select('#login-status'), error.message, 'error');
      }
    } finally {
      state.sessionChecking = false;
      if (loginForm) {
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
        syncSession();
        if (recruitmentList) renderEventsAfterSession();
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
    if (state.sessionChecking || select('[data-login-submit]').disabled) return;
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
      password.value = '';
      status(select('#login-status'), 'Đăng nhập thành công. Đang chuyển trang…', 'success');
      window.location.assign(returnTarget());
    } catch (error) {
      status(select('#login-status'), error.message, 'error');
      submit.disabled = false;
      submit.textContent = 'ĐĂNG NHẬP ↗';
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
      const message = element('p', 'member-form-status');
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      button.addEventListener('click', () => {
        if (!state.user) window.location.assign(loginUrl(event.id));
        else openApplication(event, message);
      });
      actions.append(button);
      card.append(actions, message);
      card.dataset.eventId = String(event.id);
      card.tabIndex = -1;
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

  function openApplication(event, message) {
    if (!state.user || eventIsClosed(event)) return;
    try {
      const target = new URL(event.applicationUrl);
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid registration URL');
      window.open(target.href, '_blank', 'noopener,noreferrer');
      status(message, 'Vui lòng hoàn tất gửi thông tin tại biểu mẫu đăng ký trong tab mới. Nếu chưa thấy, hãy cho phép trình duyệt mở tab mới.');
    } catch {
      status(message, 'Thông tin đăng ký sẽ được cập nhật. Vui lòng quay lại sau hoặc liên hệ CLB.');
    }
  }

  const sessionReady = loadSession();
  if (recruitmentList) {
    Promise.all([sessionReady, loadRecruitment()]).then(() => {
      renderEventsAfterSession();
      const eventId = new URLSearchParams(window.location.search).get('event');
      // Return to the selected event without creating an unsolicited popup.
      const card = [...recruitmentList.children].find((item) => item.dataset.eventId === eventId);
      if (card && state.user) card.focus();
    });
  }

  function renderEventsAfterSession() {
    // A failed request must remain an error state, not an empty event listing.
    if (select('[data-recruitment-status]')?.dataset.kind !== 'error') renderEvents();
  }
})();
