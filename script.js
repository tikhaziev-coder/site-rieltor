/* Локальные взаимодействия. Нет внешних библиотек, запросов и хранения данных. */
(() => {
  'use strict';

  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#main-nav');
  const contactDialog = document.querySelector('#contact-dialog');
  let lastTrigger = null;

  function closeMenu() {
    navigation.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Открыть меню');
  }

  menuButton.addEventListener('click', () => {
    const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
    navigation.classList.toggle('is-open', expanded);
    menuButton.setAttribute('aria-expanded', String(expanded));
    menuButton.setAttribute('aria-label', expanded ? 'Закрыть меню' : 'Открыть меню');
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('click', event => {
    if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });
  window.matchMedia('(min-width: 761px)').addEventListener('change', closeMenu);

  function openDialog(dialog, trigger) {
    // После закрытия окна возвращаем фокус на вызвавшую его кнопку.
    lastTrigger = trigger;
    document.querySelectorAll('dialog[open]').forEach(open => open.close());
    closeMenu();
    dialog.showModal();
    document.body.classList.add('modal-open');
  }

  document.querySelectorAll('[data-contact]').forEach(button => {
    button.addEventListener('click', () => openDialog(contactDialog, button));
  });

  const track = document.querySelector('#reviews-track');
  const slides = [...track.querySelectorAll('.review-slide')];
  const previous = document.querySelector('#reviews-prev');
  const next = document.querySelector('#reviews-next');
  const count = document.querySelector('#reviews-count');
  let scrollFrame = null;

  function carouselState() {
    const step = slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth;
    const maximum = Math.max(0, slides.length - 1);
    const index = Math.min(maximum, Math.max(0, Math.round(track.scrollLeft / step)));
    return { step, maximum, index };
  }

  function updateCarousel() {
    const { index, maximum } = carouselState();
    count.textContent = `${index + 1} / ${slides.length}`;
    previous.disabled = index === 0;
    next.disabled = index === maximum;
  }

  function moveCarousel(index, smooth = true) {
    const { step, maximum } = carouselState();
    const target = Math.max(0, Math.min(maximum, index));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: target * step, behavior: smooth && !reducedMotion ? 'smooth' : 'instant' });
  }

  previous.addEventListener('click', () => moveCarousel(carouselState().index - 1));
  next.addEventListener('click', () => moveCarousel(carouselState().index + 1));
  track.addEventListener('scroll', () => {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => { updateCarousel(); scrollFrame = null; });
  }, { passive: true });
  track.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { index, maximum } = carouselState();
    const targets = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: maximum };
    if (!(event.key in targets)) return;
    event.preventDefault();
    moveCarousel(targets[event.key]);
  });
  new ResizeObserver(updateCarousel).observe(track);
  updateCarousel();

  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    // Закрытие по фону без случайного закрытия при выделении текста.
    let pointerStartedOutside = false;
    const isOutside = event => {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener('pointerdown', event => { pointerStartedOutside = isOutside(event); });
    dialog.addEventListener('click', event => {
      if (event.target === dialog && pointerStartedOutside && isOutside(event)) dialog.close();
      pointerStartedOutside = false;
    });
    dialog.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) {
        document.body.classList.remove('modal-open');
        lastTrigger?.focus({ preventScroll: true });
      }
    });
  });

})();
