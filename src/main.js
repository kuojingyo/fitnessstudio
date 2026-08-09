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

function initPage() {
  initScrollReveal();
  initStickyCta();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
