import './style.css';

document.addEventListener('DOMContentLoaded', () => {
  const reveals = document.querySelectorAll('.reveal');

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -80px 0px', // 稍微提前一點觸發，避免剛好貼在螢幕邊緣
    threshold: 0.1,
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        observer.unobserve(entry.target); // 只動畫一次
      }
    });
  }, observerOptions);

  reveals.forEach(el => {
    revealObserver.observe(el);
  });
});