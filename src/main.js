import './style.css';

document.addEventListener('DOMContentLoaded', () => {
  const reveals = document.querySelectorAll('.reveal');

  function handleScrollReveal() {
    const windowHeight = window.innerHeight;
    
    // 定義動畫開始與結束的觸發線：
    // 當元素頂部到達螢幕底部（windowHeight）時開始淡入
    // 當元素頂部到達螢幕 60% 高度（windowHeight * 0.6）時完成 100% 淡入
    const startTrigger = windowHeight;
    const endTrigger = windowHeight * 0.6;
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
});