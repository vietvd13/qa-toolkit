// Đánh dấu khi tool đang mở bên trong bộ công cụ (iframe) → theme.css ẩn đầu trang riêng của tool
if (window.top !== window) document.documentElement.classList.add('embed');
