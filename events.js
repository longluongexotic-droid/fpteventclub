import { supabase, isSupabaseConfigured } from './supabase-client.js';

const archive = document.querySelector('.events-archive');

if (archive) {
  const search = archive.querySelector('#events-search');
  const category = archive.querySelector('#events-category');
  const yearButtons = [...archive.querySelectorAll('[data-year-filter]')];
  const status = archive.querySelector('#events-status');
  const retry = archive.querySelector('#events-retry');
  const results = archive.querySelector('#ket-qua-su-kien');
  const list = archive.querySelector('#events-list');
  const empty = archive.querySelector('#events-empty');
  const yearNumber = archive.querySelector('[data-events-year-number]');
  const resultTitle = archive.querySelector('[data-events-results-title]');
  const totalLabel = document.querySelector('[data-events-total-label]');
  const heroCount = document.querySelector('[data-events-hero-count]');
  const footerCount = document.querySelector('[data-events-footer-count]');
  const allowedYears = new Set(['all', '2022', '2023', '2024', '2025', '2026']);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const numberFormat = new Intl.NumberFormat('vi-VN');
  let events = [];
  let loaded = false;
  let renderedOnce = false;
  let authorizedUserId = null;
  let authRevision = 0;
  let selectedYear = /^#nam-(all|202[2-6])$/.exec(window.location.hash)?.[1] || '2026';

  const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' })
    : null;

  function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi-VN');
  }

  function registrationUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  }

  function applyAuth(user, profile) {
    const memberEmail = (profile?.email || '').toLowerCase().endsWith('@fpt.edu.vn');
    const nextUserId = user?.id && profile?.id === user.id && profile.is_active &&
      (profile.role === 'admin' || (profile.role === 'member' && memberEmail))
      ? user.id : null;
    if (nextUserId === authorizedUserId) return;
    authorizedUserId = nextUserId;
    if (loaded) render();
  }

  async function initializeAuth() {
    if (!isSupabaseConfigured) return;
    const revision = authRevision;
    try {
      const { data: session, error: userError } = await supabase.auth.getUser();
      if (userError || !session?.user) {
        if (revision === authRevision) applyAuth(null, null);
        return;
      }
      const { data: profile, error: profileError } = await supabase.from('profiles')
        .select('id,email,role,is_active').eq('id', session.user.id).maybeSingle();
      if (revision === authRevision && !profileError) applyAuth(session.user, profile);
    } catch (error) {
      console.error('Không kiểm tra được quyền xem liên kết sự kiện:', error);
    }
  }

  async function revealRegistrationLink(event, button, linkStatus) {
    if (!authorizedUserId) return;
    const requestingUserId = authorizedUserId;
    button.disabled = true;
    linkStatus.textContent = 'Đang lấy liên kết đăng ký...';
    try {
      const { data, error } = await supabase.rpc('fev_event_registration_link', {
        p_event_id: event.id,
      });
      if (error) throw error;
      if (authorizedUserId !== requestingUserId || !button.isConnected) return;
      const href = registrationUrl(data);
      if (!href) {
        linkStatus.textContent = 'Sự kiện này chưa có liên kết đăng ký.';
        return;
      }
      const link = document.createElement('a');
      link.className = 'event-marker event-registration-link';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '↗';
      link.setAttribute('aria-label', `Mở đăng ký ${event.title} trong tab mới`);
      button.replaceWith(link);
      linkStatus.textContent = 'Liên kết đã sẵn sàng. Nhấn mũi tên để mở tab mới.';
      link.focus();
    } catch (error) {
      console.error('Không lấy được liên kết đăng ký sự kiện:', error);
      if (button.isConnected) linkStatus.textContent = 'Chưa thể lấy liên kết. Vui lòng thử lại.';
    } finally {
      button.disabled = false;
    }
  }

  function setYear(year) {
    if (!allowedYears.has(year)) return;
    selectedYear = year;
    yearButtons.forEach((button) => {
      const active = button.dataset.yearFilter === year;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (loaded) render();
  }

  function makeRow(event, index, animate) {
    const row = document.createElement('li');
    row.className = 'event-row reveal';
    if (!animate || !revealObserver || reduceMotion.matches) row.classList.add('is-visible');

    const number = document.createElement('span');
    number.className = 'event-index';
    number.textContent = String(index + 1).padStart(2, '0');

    const title = document.createElement('h3');
    title.textContent = event.title;

    const detail = document.createElement('p');
    detail.className = 'event-theme';
    if (event.description?.trim()) {
      const description = document.createElement('span');
      description.textContent = event.description;
      detail.append(description);
    }
    if (event.category) {
      const badge = document.createElement('span');
      badge.className = 'event-category';
      badge.textContent = event.category;
      detail.append(badge);
    }
    if (!detail.childNodes.length) detail.textContent = '—';

    let marker;
    if (authorizedUserId) {
      const linkStatus = document.createElement('span');
      linkStatus.className = 'event-link-status';
      linkStatus.setAttribute('role', 'status');
      detail.append(linkStatus);
      marker = document.createElement('button');
      marker.className = 'event-marker event-registration-button';
      marker.type = 'button';
      marker.textContent = '↗';
      marker.setAttribute('aria-label', `Xem liên kết đăng ký ${event.title}`);
      marker.addEventListener('click', () => revealRegistrationLink(event, marker, linkStatus));
    } else {
      marker = document.createElement('span');
      marker.className = 'event-marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = '✳';
    }

    row.append(number, title, detail, marker);
    return row;
  }

  function render() {
    const query = normalize(search.value.trim());
    const filtered = events.filter((event) =>
      (selectedYear === 'all' || String(event.year) === selectedYear) &&
      (!category.value || event.category === category.value) &&
      (!query || normalize(event.title).includes(query))
    );
    const animate = !renderedOnce;
    revealObserver?.disconnect();
    const fragment = document.createDocumentFragment();
    filtered.forEach((event, index) => fragment.append(makeRow(event, index, animate)));
    list.replaceChildren(fragment);
    if (animate && revealObserver && !reduceMotion.matches) {
      list.querySelectorAll('.reveal').forEach((row) => revealObserver.observe(row));
    }
    renderedOnce = true;
    yearNumber.textContent = selectedYear === 'all' ? 'FEV' : selectedYear;
    resultTitle.textContent = `${numberFormat.format(filtered.length)} DẤU ẤN SỰ KIỆN`;
    results.hidden = filtered.length === 0;
    empty.hidden = filtered.length > 0;
    empty.textContent = events.length === 0
      ? 'Kho sự kiện đang được cập nhật. Vui lòng quay lại sau.'
      : category.value && events.every((event) => !event.category)
        ? 'Danh mục sự kiện đang được cập nhật. Vui lòng quay lại sau.'
        : 'Chưa có sự kiện phù hợp với bộ lọc này.';
    status.textContent = `Hiển thị ${numberFormat.format(filtered.length)} trong ${numberFormat.format(events.length)} sự kiện.`;
  }

  async function fetchAllEvents() {
    const pageSize = 500;
    const rows = [];
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await supabase
        .from('events')
        .select('id,title,year,category,description,created_at,display_order')
        .gte('year', 2022)
        .lte('year', 2026)
        .order('year', { ascending: false })
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(start, start + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < pageSize) return rows;
    }
  }

  async function loadEvents() {
    retry.hidden = true;
    status.textContent = 'Đang tải kho sự kiện...';
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
      events = await fetchAllEvents();
      loaded = true;
      const count = numberFormat.format(events.length);
      heroCount.textContent = count;
      totalLabel.textContent = `${count} SỰ KIỆN`;
      footerCount.textContent = count;
      yearButtons.forEach((button) => {
        const year = button.dataset.yearFilter;
        const amount = year === 'all' ? events.length : events.filter((event) => String(event.year) === year).length;
        button.querySelector('small').textContent = `${numberFormat.format(amount)} SỰ KIỆN`;
      });
      render();
    } catch (error) {
      console.error('Không tải được kho sự kiện FEV:', error);
      loaded = false;
      results.hidden = true;
      empty.hidden = true;
      status.textContent = 'Chưa thể tải sự kiện. Vui lòng thử lại sau.';
      retry.hidden = false;
    }
  }

  yearButtons.forEach((button) => button.addEventListener('click', () => {
    const year = button.dataset.yearFilter;
    setYear(year);
    window.history.replaceState(null, '', `#nam-${year}`);
  }));
  window.addEventListener('hashchange', () => {
    const year = /^#nam-(all|202[2-6])$/.exec(window.location.hash)?.[1];
    if (year) setYear(year);
  });
  search.addEventListener('input', () => { if (loaded) render(); });
  category.addEventListener('change', () => { if (loaded) render(); });
  retry.addEventListener('click', loadEvents);
  document.addEventListener('fev:authchange', (event) => {
    authRevision += 1;
    applyAuth(event.detail?.user, event.detail?.profile);
  });
  setYear(selectedYear);
  initializeAuth();
  loadEvents();
}
