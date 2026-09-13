(() => {
  'use strict';

  document.documentElement.classList.add('js');

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const menuToggle = document.querySelector('#menu-toggle');
  const menu = document.querySelector('#site-menu');

  if (menuToggle && menu) {
    const background = [...document.querySelectorAll('main#noi-dung, footer')];
    const menuHeader = menuToggle.closest('[data-header]');
    const focusableSelector = 'a[href], button, input, select, textarea, [tabindex]';
    const inertState = new Map();
    const isMenuOpen = () => menuToggle.getAttribute('aria-expanded') === 'true';

    const setMenuOpen = (open, restoreFocus = false) => {
      if (open && !isMenuOpen()) {
        background.forEach((element) => {
          inertState.set(element, element.inert);
          element.inert = true;
        });
      } else if (!open) {
        inertState.forEach((wasInert, element) => { element.inert = wasInert; });
        inertState.clear();
      }
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
      menu.hidden = !open;
      document.body.classList.toggle('menu-open', open);
      if (restoreFocus) menuToggle.focus();
    };

    menuToggle.addEventListener('click', () => setMenuOpen(!isMenuOpen()));
    menu.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) {
        setMenuOpen(false);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (!isMenuOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false, true);
      } else if (event.key === 'Tab') {
        const candidates = [
          ...(menuHeader ? menuHeader.querySelectorAll(focusableSelector) : [menuToggle]),
          ...menu.querySelectorAll(focusableSelector),
        ];
        const focusable = [...new Set(candidates)].filter((element) =>
          element.tabIndex >= 0 && !element.matches(':disabled') &&
          !element.closest('[hidden], [inert]') && element.getClientRects().length > 0 &&
          window.getComputedStyle(element).visibility !== 'hidden'
        );
        const first = focusable[0] || menuToggle;
        const last = focusable[focusable.length - 1] || menuToggle;
        const active = document.activeElement;
        if (!focusable.includes(active) || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    });
    document.addEventListener('click', (event) => {
      if (isMenuOpen() && !menu.contains(event.target) && !menuToggle.contains(event.target)) {
        setMenuOpen(false);
      }
    });
  }

  const header = document.querySelector('[data-header]');
  if (header) {
    let scrollPending = false;
    const updateHeader = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 24);
      scrollPending = false;
    };
    updateHeader();
    window.addEventListener('scroll', () => {
      if (!scrollPending) {
        scrollPending = true;
        window.requestAnimationFrame(updateHeader);
      }
    }, { passive: true });
  }

  const year = document.querySelector('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  const reveals = [...document.querySelectorAll('.reveal')];
  const counters = [...document.querySelectorAll('.stat-number[data-count]')];
  const canObserve = 'IntersectionObserver' in window;

  if (!canObserve || motion.matches) {
    reveals.forEach((element) => element.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
    reveals.forEach((element) => revealObserver.observe(element));

    motion.addEventListener?.('change', (event) => {
      if (event.matches) {
        revealObserver.disconnect();
        reveals.forEach((element) => element.classList.add('is-visible'));
      }
    });
  }

  if (canObserve && !motion.matches && counters.length) {
    const formatter = new Intl.NumberFormat('vi-VN');
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        counterObserver.unobserve(entry.target);

        const element = entry.target;
        const target = Number(element.dataset.count);
        if (!Number.isFinite(target) || target < 0) return;

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let numberNode = walker.nextNode();
        while (numberNode && !/\d/.test(numberNode.nodeValue)) numberNode = walker.nextNode();
        if (!numberNode) return;
        const finalText = numberNode.nodeValue;
        const duration = 1100;
        let startedAt;

        const tick = (timestamp) => {
          if (motion.matches) {
            numberNode.nodeValue = finalText;
            return;
          }
          startedAt ??= timestamp;
          const progress = Math.min((timestamp - startedAt) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          numberNode.nodeValue = finalText.replace(/\d[\d.,]*/, formatter.format(Math.round(target * eased)));
          if (progress < 1) window.requestAnimationFrame(tick);
          else numberNode.nodeValue = finalText;
        };
        window.requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });
    counters.forEach((element) => counterObserver.observe(element));
  }

  if (canObserve) {
    const sectionIds = ['gioi-thieu', 'dinh-huong', 'to-chuc', 'cot-moc', 'hanh-trinh', 'ket-noi'];
    const sections = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
    const links = [...document.querySelectorAll('nav a[href^="#"]')]
      .filter((link) => sectionIds.includes(link.getAttribute('href').slice(1)));
    const visibleSections = new Map();

    if (sections.length && links.length) {
      const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => visibleSections.set(entry.target.id, entry.isIntersecting));
        const active = sections.find((section) => visibleSections.get(section.id));
        links.forEach((link) => {
          const isActive = Boolean(active && link.getAttribute('href') === `#${active.id}`);
          link.classList.toggle('is-active', isActive);
          if (isActive) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }, { rootMargin: '-15% 0px -45% 0px', threshold: 0 });
      sections.forEach((section) => sectionObserver.observe(section));
    }
  }
})();
