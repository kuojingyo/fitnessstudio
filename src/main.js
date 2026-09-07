function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length === 0) return;

  if (typeof window.IntersectionObserver !== 'function') {
    reveals.forEach(element => element.classList.add('active'));
    return;
  }

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -30% 0px', // 當元素頂部滑到螢幕 70% 高度位置時觸發（相當於底邊界縮排 30%）
    threshold: 0,
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // 當觸碰觸發線時，新增 .active 類別，交由 CSS 執行 3 秒的平滑過渡
        entry.target.classList.add('active');
        observer.unobserve(entry.target); // 動畫只播放一次
      }
    });
  }, observerOptions);

  reveals.forEach(el => {
    // 由於我們使用的是 CSS transition，在此要清除 JS 之前可能留下的 style 屬性
    el.style.opacity = '';
    el.style.transform = '';
    revealObserver.observe(el);
  });
}

function initStickyCta() {
  const cta = document.getElementById('sticky-cta');
  if (!cta) return;

  let isVisible = null;
  let framePending = false;

  const update = () => {
    const shouldShow = window.scrollY > 300;
    if (shouldShow !== isVisible) {
      cta.classList.toggle('opacity-100', shouldShow);
      cta.classList.toggle('translate-y-0', shouldShow);
      cta.classList.toggle('opacity-0', !shouldShow);
      cta.classList.toggle('pointer-events-none', !shouldShow);
      cta.classList.toggle('translate-y-4', !shouldShow);
      isVisible = shouldShow;
    }
    framePending = false;
  };

  window.addEventListener('scroll', () => {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(update);
  }, { passive: true });

  update();
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
    const inSticky = link.id === 'sticky-cta' || !!closest(link, '#sticky-cta');
    const inFooter = !!closest(link, 'footer');
    let placement = 'body';
    if (inSticky) placement = 'sticky';
    else if (inHero) placement = 'hero';
    else if (inFooter) placement = 'footer';

    window.dataLayer.push({
      event: 'contact_click',
      channel,
      placement,
      page_path: window.location.pathname,
    });
  }, { passive: true });
}

function initPage() {
  initScrollReveal();
  initStickyCta();
  initContactTracking();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
