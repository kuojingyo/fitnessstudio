import './style.css';

console.log('Scroll reveal script loaded');

function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');
  console.log(`Found ${reveals.length} scroll-reveal elements`);
  if (reveals.length === 0) return;

  function handleScrollReveal() {
    const windowHeight = window.innerHeight;
    const startTrigger = windowHeight * 0.7; // 開始淡入：進入螢幕 70% 高度（視窗中下部）
    const endTrigger = windowHeight * 0.5;   // 淡入完成：到達螢幕 50% 高度（最佳觀賞的視窗正中央）
    const triggerRange = startTrigger - endTrigger;

    reveals.forEach(el => {
      const rect = el.getBoundingClientRect();
      
      if (rect.top >= startTrigger) {
        // 還沒進入可視範圍
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
      } else if (rect.top <= endTrigger) {
        // 已經完全進入
        el.style.opacity = '1';
        el.style.transform = 'translateY(0px)';
      } else {
        // 介於兩者之間：計算滾動比例並進行二次方緩和（Ease-Out）插值，使過渡更柔和
        const scrolledFraction = (startTrigger - rect.top) / triggerRange;
        const easeFraction = 1 - Math.pow(1 - scrolledFraction, 2);
        
        el.style.opacity = easeFraction;
        el.style.transform = `translateY(${30 * (1 - easeFraction)}px)`;
      }
    });
  }

  // 初始化執行一次
  handleScrollReveal();
  
  // 監聽滾動與視窗大小改變事件
  window.addEventListener('scroll', handleScrollReveal, { passive: true });
  window.addEventListener('resize', handleScrollReveal, { passive: true });
}

// 確保在 DOM 可操作時立即執行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScrollReveal);
} else {
  initScrollReveal();
}