function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length === 0) return;

  const revealAll = () => reveals.forEach(element => element.classList.add('active'));

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealAll();
    return;
  }

  if (typeof window.IntersectionObserver !== 'function') {
    revealAll();
    return;
  }

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -12% 0px',
    threshold: 0,
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  reveals.forEach(el => {
    el.style.opacity = '';
    el.style.transform = '';
    revealObserver.observe(el);
  });

  // LINE 內建瀏覽器或背景分頁若延遲 IntersectionObserver，內容仍會自動顯示。
  window.setTimeout(revealAll, 1800);
}

// P02 量測：聯絡點擊事件（GA4 dataLayer，無 cookie／不傳任何個人資料）
// - 只記「點了哪個聯絡入口」；LINE 點擊 ≠ 有效詢問，後續由人工 lead ledger 對照
// - 隱私頁同步說明：公開頁僅記錄匿名點擊統計，不使用廣告追蹤
function initContactTracking() {
  if (typeof window.dataLayer === 'undefined') {
    window.dataLayer = [];
  }

  const closest = (el, selector) => (el.closest ? el.closest(selector) : null);

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = closest(event.target, 'a[href]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    let channel = null;
    if (href.startsWith('https://lin.ee/') || href.startsWith('https://line.me/')) channel = 'line';
    else if (href.startsWith('tel:')) channel = 'phone';
    else if (href.startsWith('https://www.google.com/maps') || href.startsWith('https://maps.google.com') || href.startsWith('https://maps.app.goo.gl')) channel = 'map';

    if (!channel) return;

    const inHero = !!closest(link, '#hero');
    const inFooter = !!closest(link, 'footer');
    let placement = 'body';
    if (inHero) placement = 'hero';
    else if (inFooter) placement = 'footer';

    window.dataLayer.push({
      event: 'contact_click',
      channel,
      placement,
      page_path: window.location.pathname,
    });
  }, { passive: true });
}

function initMobileMenu() {
  const menu = document.querySelector('.site-mobile-menu');
  if (!menu) return;

  menu.addEventListener('click', event => {
    if (event.target.closest('a')) menu.removeAttribute('open');
  });

  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.removeAttribute('open');
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.removeAttribute('open');
      menu.querySelector('summary')?.focus();
    }
  });
}

function initPage() {
  initScrollReveal();
  initMobileMenu();
  initContactTracking();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
